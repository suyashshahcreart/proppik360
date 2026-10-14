package processor

import (
	"archive/zip"
	"context"
	"fmt"
	"log"
	"os"
	"time"
)

// PipelineConfig is everything RunPipeline needs. It embeds JobConfig fields
// the publish pool already uses, plus ingest + backup settings.
type PipelineConfig struct {
	JobConfig
	Ingest               *IngestStore
	BackupVerifyAttempts int
}

// RunPipeline runs publish → ready → backup → cleanup.
// phase limits the work:
//
//	"" / "publish" — full path (legacy download if no local ZIP)
//	"backup"       — backup + cleanup only
//	"cleanup"      — verified temp delete only
func RunPipeline(ctx context.Context, cfg PipelineConfig, tourID, phase string) {
	start := time.Now()
	log.Printf("[job:%s] Started phase=%q", tourID, phase)

	if err := runPipeline(ctx, cfg, tourID, phase); err != nil {
		log.Printf("[job:%s] FAILED after %s: %v", tourID, time.Since(start), err)
		status := ""
		if tourData, getErr := cfg.WorkerClient.GetTour(tourID); getErr == nil {
			status = tourData.Tour.Status
		}
		// A tour that is already live must stay ready if only backup/cleanup failed.
		if status == "ready" || status == "completed" {
			log.Printf("[job:%s] leaving status=%s; backup/cleanup will retry", tourID, status)
			return
		}
		if notifyErr := cfg.WorkerClient.Fail(tourID, err.Error()); notifyErr != nil {
			log.Printf("[job:%s] Also failed to notify worker of failure: %v", tourID, notifyErr)
		}
		return
	}
	log.Printf("[job:%s] Completed successfully in %s", tourID, time.Since(start))
}

func runPipeline(ctx context.Context, cfg PipelineConfig, tourID, phase string) error {
	attempts := cfg.BackupVerifyAttempts
	if attempts <= 0 {
		attempts = 3
	}

	var sess *IngestSession
	if cfg.Ingest != nil {
		loaded, err := cfg.Ingest.Load(tourID)
		if err == nil {
			sess = loaded
		}
	}

	if phase == "cleanup" {
		return finishCleanup(ctx, cfg, tourID, sess, attempts)
	}
	if phase == "backup" {
		if sess != nil && sess.SaveBackupZip {
			if err := runBackupPhase(ctx, cfg, tourID, sess, attempts); err != nil {
				return err
			}
		}
		return finishCleanup(ctx, cfg, tourID, sess, attempts)
	}

	zipPath, flat, err := resolveZip(ctx, cfg, tourID, sess)
	if err != nil {
		return err
	}
	defer func() {
		// Legacy downloads have no ingest session — delete the ZIP here.
		// Go-first ZIPs are removed only after backup verification.
		if !flat {
			removeFile(zipPath)
		}
	}()

	if sess == nil || !sess.PublishDone {
		if err := runPublishPhase(ctx, cfg, tourID, zipPath, flat, sess); err != nil {
			return err
		}
	}

	if flat {
		if sess != nil && sess.SaveBackupZip {
			if err := runBackupPhase(ctx, cfg, tourID, sess, attempts); err != nil {
				return err
			}
		}
		return finishCleanup(ctx, cfg, tourID, sess, attempts)
	}
	return nil
}

func resolveZip(ctx context.Context, cfg PipelineConfig, tourID string, sess *IngestSession) (string, bool, error) {
	if sess != nil && sess.Assembled && sess.ZipPath != "" {
		if _, err := os.Stat(sess.ZipPath); err == nil {
			return sess.ZipPath, true, nil
		}
	}

	log.Printf("[job:%s] No local ZIP — legacy download from R2", tourID)
	tourData, err := cfg.WorkerClient.GetTour(tourID)
	if err != nil {
		return "", false, fmt.Errorf("GetTour: %w", err)
	}
	if tourData.Tour.Status == "ready" || tourData.Tour.Status == "completed" {
		log.Printf("[job:%s] Tour already %s — skipping download", tourID, tourData.Tour.Status)
		return "", false, nil
	}
	if err := cfg.WorkerClient.SetStage(tourID, "downloading"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}
	zipPath, err := DownloadZIP(tourData.DownloadURL, cfg.TempDir, tourID, cfg.DownloadConcurrency, cfg.DownloadSemaphore)
	if err != nil {
		return "", false, fmt.Errorf("download: %w", err)
	}
	return zipPath, false, nil
}

func runPublishPhase(ctx context.Context, cfg PipelineConfig, tourID, zipPath string, flat bool, sess *IngestSession) error {
	if zipPath == "" {
		return nil
	}
	log.Printf("[job:%s] Opening and analyzing ZIP", tourID)
	if err := cfg.WorkerClient.SetStage(tourID, "extracting"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}

	zipReader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open ZIP reader: %w", err)
	}
	defer zipReader.Close()

	stats, files := AnalyzeZIPReader(zipReader)
	if len(files) == 0 {
		return fmt.Errorf("ZIP contains no files")
	}
	procCfg := CalcConfig(stats)
	format := DetectFormat(files)
	stripPrefix := StripTopLevelFolder(files)

	prefix := tourID + "/viewer/"
	if flat {
		prefix = publishPrefix(tourID)
	}
	tasks := BuildUploadTasks(files, prefix, stripPrefix)
	log.Printf("[job:%s] Built %d upload tasks (prefix=%s flat=%v)", tourID, len(tasks), prefix, flat)

	var manifest *Manifest
	var published map[string]struct{}
	if flat && cfg.Ingest != nil {
		manifest, err = LoadManifest(ctx, cfg.R2Client, tourID)
		if err != nil {
			return fmt.Errorf("load manifest: %w", err)
		}
		published, err = cfg.Ingest.LoadPublished(tourID)
		if err != nil {
			return err
		}
		filtered := tasks[:0]
		resume := len(published) > 0
		for _, t := range tasks {
			rel := relativeFromKey(prefix, t.R2Key)
			if _, ok := published[rel]; ok {
				continue
			}
			if resume && ShouldSkipPublish(ctx, cfg.R2Client, t.R2Key, t.FileSize, published, rel) {
				continue
			}
			filtered = append(filtered, t)
		}
		log.Printf("[job:%s] Merge publish: %d to upload, %d already on R2", tourID, len(filtered), len(tasks)-len(filtered))
		tasks = filtered
	}

	totalUploadBytes := computeTotalBytes(tasks)
	stage := "uploading_assets"
	if flat {
		stage = "publishing"
	}
	if err := cfg.WorkerClient.Progress(tourID, 0, len(tasks), 0, totalUploadBytes, stage); err != nil {
		log.Printf("[job:%s] initial progress ping failed (non-fatal): %v", tourID, err)
	}

	result := RunWorkerPool(ctx, cfg.R2Client, tasks, procCfg.Concurrency, procCfg.PartSizeBytes, tourID, cfg.TempDir, cfg.WorkerClient, cfg.UploadLimiter, stage)
	if result.Failed > 0 {
		return fmt.Errorf("%d/%d files failed to upload", result.Failed, len(tasks))
	}

	if flat && cfg.Ingest != nil && manifest != nil {
		now := time.Now().UTC().Format(time.RFC3339)
		version := ""
		if sess != nil {
			version = sess.BackupVersion
		}
		zipReader.Close()
		zipReader2, err := zip.OpenReader(zipPath)
		if err != nil {
			return fmt.Errorf("reopen ZIP: %w", err)
		}
		_, allFiles := AnalyzeZIPReader(zipReader2)
		zipReader2.Close()
		allTasks := BuildUploadTasks(allFiles, prefix, stripPrefix)
		for _, t := range allTasks {
			rel := relativeFromKey(prefix, t.R2Key)
			manifest.Files[rel] = ManifestFile{Size: t.FileSize, UpdatedAt: now}
			_ = cfg.Ingest.MarkPublished(tourID, rel)
		}
		manifest.UploadVersion = version
		if err := SaveManifest(ctx, cfg.R2Client, tourID, manifest); err != nil {
			return fmt.Errorf("save manifest: %w", err)
		}
	}

	entry := EntryPointFile(format)
	viewerURL := buildViewerURL(cfg.R2PublicDomain, cfg.R2BucketName, prefix, entry)
	if viewerURL == "" {
		return fmt.Errorf("R2_PUBLIC_DOMAIN is not configured")
	}
	layout := ""
	if flat {
		layout = "flat"
	}
	if err := cfg.WorkerClient.SetStage(tourID, "finalizing"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}
	if err := cfg.WorkerClient.Complete(tourID, viewerURL, layout); err != nil {
		return fmt.Errorf("notify ready: %w", err)
	}
	if sess != nil && cfg.Ingest != nil {
		sess.PublishDone = true
		if err := cfg.Ingest.Update(sess); err != nil {
			log.Printf("[job:%s] session update failed (non-fatal): %v", tourID, err)
		}
	}
	return nil
}

func runBackupPhase(ctx context.Context, cfg PipelineConfig, tourID string, sess *IngestSession, attempts int) error {
	if sess == nil || sess.ZipPath == "" {
		return fmt.Errorf("no local ZIP to back up")
	}
	if _, err := os.Stat(sess.ZipPath); err != nil {
		return fmt.Errorf("local ZIP missing: %w", err)
	}
	if err := cfg.WorkerClient.SetStage(tourID, "backing_up"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}

	version := sess.BackupVersion
	if version == "" {
		version = "first"
	}
	name := SanitizeZipBase(sess.Filename)
	objectName := BackupZipName(name, version, time.Now())
	key := BackupKey(tourID, objectName)

	partSize := int64(20 * MB)
	if err := UploadBackup(ctx, cfg.R2Client, key, sess.ZipPath, partSize); err != nil {
		return fmt.Errorf("backup upload: %w", err)
	}
	if err := VerifyBackup(ctx, cfg.R2Client, key, sess.ZipPath, attempts); err != nil {
		return fmt.Errorf("backup verify: %w", err)
	}
	sess.BackupKey = key
	sess.BackupVerified = true
	if cfg.Ingest != nil {
		if err := cfg.Ingest.Update(sess); err != nil {
			return err
		}
	}
	if err := cfg.WorkerClient.BackupComplete(tourID, key, version); err != nil {
		return fmt.Errorf("notify backup: %w", err)
	}
	return nil
}

func finishCleanup(ctx context.Context, cfg PipelineConfig, tourID string, sess *IngestSession, attempts int) error {
	if sess == nil {
		return nil
	}
	if err := cfg.WorkerClient.SetStage(tourID, "cleanup"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}
	entryKey := publishPrefix(tourID) + "index.html"
	var err error
	if sess.SaveBackupZip {
		err = CleanupAfterBackup(ctx, cfg.R2Client, cfg.Ingest, tourID, sess.BackupKey, sess.ZipPath, entryKey, attempts)
	} else {
		err = CleanupWithoutBackup(ctx, cfg.R2Client, cfg.Ingest, tourID, sess.ZipPath, entryKey)
	}
	if err != nil {
		return err
	}
	if err := cfg.WorkerClient.MarkCompleted(tourID); err != nil {
		return fmt.Errorf("notify completed: %w", err)
	}
	return nil
}
