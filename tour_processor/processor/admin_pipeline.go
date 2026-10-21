package processor

import (
	"archive/zip"
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"tour-processor/r2"
)

// AdminPipelineConfig extends PipelineConfig with a separate R2 client/domain for admin packages.
type AdminPipelineConfig struct {
	PipelineConfig
	AdminR2Client     *r2.Client
	AdminR2BucketName string
	AdminPublicDomain string
}

// RunAdminPipeline publishes a tour_admin ZIP to the admin R2 bucket.
// It never updates tours.status — Worker artifact endpoints only.
func RunAdminPipeline(ctx context.Context, cfg AdminPipelineConfig, tourID string) {
	start := time.Now()
	log.Printf("[admin-job:%s] Started", tourID)

	if err := runAdminPipeline(ctx, cfg, tourID); err != nil {
		log.Printf("[admin-job:%s] FAILED after %s: %v", tourID, time.Since(start), err)
		if notifyErr := cfg.WorkerClient.ArtifactFail(tourID, ArtifactTourAdmin, err.Error()); notifyErr != nil {
			log.Printf("[admin-job:%s] Also failed to notify worker: %v", tourID, notifyErr)
		}
		return
	}
	log.Printf("[admin-job:%s] Completed successfully in %s", tourID, time.Since(start))
}

func runAdminPipeline(ctx context.Context, cfg AdminPipelineConfig, tourID string) error {
	if cfg.AdminR2Client == nil {
		return fmt.Errorf("admin R2 client is not configured (set R2_ADMIN_BUCKET_NAME)")
	}
	if strings.TrimSpace(cfg.AdminPublicDomain) == "" {
		return fmt.Errorf("R2_ADMIN_PUBLIC_DOMAIN is not configured")
	}

	attempts := cfg.BackupVerifyAttempts
	if attempts <= 0 {
		attempts = 3
	}

	sessionKey := IngestSessionKey(tourID, ArtifactTourAdmin)
	var sess *IngestSession
	if cfg.Ingest != nil {
		loaded, err := cfg.Ingest.Load(sessionKey)
		if err != nil {
			return fmt.Errorf("load admin ingest session: %w", err)
		}
		sess = loaded
	}
	if sess == nil || !sess.Assembled || sess.ZipPath == "" {
		return fmt.Errorf("no assembled admin ZIP for tour %s", tourID)
	}
	if _, err := os.Stat(sess.ZipPath); err != nil {
		return fmt.Errorf("admin ZIP missing: %w", err)
	}

	if !sess.PublishDone {
		if err := runAdminPublish(ctx, cfg, tourID, sessionKey, sess); err != nil {
			return err
		}
	}

	if sess.SaveBackupZip {
		if err := runAdminBackup(ctx, cfg, tourID, sess, attempts); err != nil {
			return err
		}
	}

	return finishAdminCleanup(ctx, cfg, tourID, sessionKey, sess, attempts)
}

func runAdminPublish(ctx context.Context, cfg AdminPipelineConfig, tourID, sessionKey string, sess *IngestSession) error {
	zipPath := sess.ZipPath
	log.Printf("[admin-job:%s] Opening admin ZIP", tourID)
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "extracting")

	zipReader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open ZIP: %w", err)
	}
	defer zipReader.Close()

	stats, files := AnalyzeZIPReader(zipReader)
	if len(files) == 0 {
		return fmt.Errorf("ZIP contains no files")
	}
	if !adminZipHasIndex(files) {
		return fmt.Errorf("admin ZIP must contain index.html at root or under a single top-level folder")
	}

	procCfg := CalcConfig(stats)
	stripPrefix := StripTopLevelFolder(files)
	prefix := publishPrefix(tourID)
	tasks := BuildUploadTasks(files, prefix, stripPrefix)
	log.Printf("[admin-job:%s] Built %d upload tasks (prefix=%s)", tourID, len(tasks), prefix)

	manifest, err := LoadManifest(ctx, cfg.AdminR2Client, tourID)
	if err != nil {
		return fmt.Errorf("load manifest: %w", err)
	}
	published, err := cfg.Ingest.LoadPublished(sessionKey)
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
		if resume && ShouldSkipPublish(ctx, cfg.AdminR2Client, t.R2Key, t.FileSize, published, rel) {
			continue
		}
		filtered = append(filtered, t)
	}
	tasks = filtered

	totalUploadBytes := computeTotalBytes(tasks)
	_ = cfg.WorkerClient.ArtifactProgress(tourID, ArtifactTourAdmin, 0, len(tasks), 0, totalUploadBytes, "publishing")

	// Pass nil workerClient so pool progress uses ArtifactProgress from our stage pings only.
	result := RunWorkerPool(
		ctx,
		cfg.AdminR2Client,
		tasks,
		procCfg.Concurrency,
		procCfg.PartSizeBytes,
		tourID,
		cfg.TempDir,
		nil,
		cfg.UploadLimiter,
		"publishing",
	)
	if result.Failed > 0 {
		return fmt.Errorf("%d/%d files failed to upload", result.Failed, len(tasks))
	}

	now := time.Now().UTC().Format(time.RFC3339)
	zipReader2, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("reopen ZIP: %w", err)
	}
	_, allFiles := AnalyzeZIPReader(zipReader2)
	zipReader2.Close()
	allTasks := BuildUploadTasks(allFiles, prefix, StripTopLevelFolder(allFiles))
	for _, t := range allTasks {
		rel := relativeFromKey(prefix, t.R2Key)
		manifest.Files[rel] = ManifestFile{Size: t.FileSize, UpdatedAt: now}
		_ = cfg.Ingest.MarkPublished(sessionKey, rel)
	}
	manifest.UploadVersion = sess.BackupVersion
	if err := SaveManifest(ctx, cfg.AdminR2Client, tourID, manifest); err != nil {
		return fmt.Errorf("save manifest: %w", err)
	}

	publishURL := buildViewerURL(cfg.AdminPublicDomain, cfg.AdminR2BucketName, prefix, "index.html")
	if publishURL == "" {
		return fmt.Errorf("could not build admin publish URL")
	}
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "finalizing")
	if err := cfg.WorkerClient.ArtifactComplete(tourID, ArtifactTourAdmin, publishURL, "flat", sess.SaveBackupZip); err != nil {
		return fmt.Errorf("notify ready: %w", err)
	}
	sess.PublishDone = true
	if err := cfg.Ingest.Update(sess); err != nil {
		log.Printf("[admin-job:%s] session update failed (non-fatal): %v", tourID, err)
	}
	return nil
}

func adminZipHasIndex(files []*zip.File) bool {
	strip := StripTopLevelFolder(files)
	for _, f := range files {
		name := f.Name
		if strip != "" && strings.HasPrefix(name, strip) {
			name = strings.TrimPrefix(name, strip)
		}
		name = strings.TrimPrefix(name, "/")
		if strings.EqualFold(name, "index.html") {
			return true
		}
	}
	return false
}

func runAdminBackup(ctx context.Context, cfg AdminPipelineConfig, tourID string, sess *IngestSession, attempts int) error {
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "backing_up")
	version := sess.BackupVersion
	if version == "" {
		version = "first"
	}
	name := SanitizeZipBase(sess.Filename)
	objectName := BackupZipName(name, version, time.Now())
	key := BackupKey(tourID, objectName)

	partSize := int64(20 * MB)
	if err := UploadBackup(ctx, cfg.AdminR2Client, key, sess.ZipPath, partSize); err != nil {
		return fmt.Errorf("backup upload: %w", err)
	}
	if err := VerifyBackup(ctx, cfg.AdminR2Client, key, sess.ZipPath, attempts); err != nil {
		return fmt.Errorf("backup verify: %w", err)
	}
	sess.BackupKey = key
	sess.BackupVerified = true
	if err := cfg.Ingest.Update(sess); err != nil {
		return err
	}
	if err := cfg.WorkerClient.ArtifactBackupComplete(tourID, ArtifactTourAdmin, key, version); err != nil {
		return fmt.Errorf("notify backup: %w", err)
	}
	return nil
}

func finishAdminCleanup(ctx context.Context, cfg AdminPipelineConfig, tourID, sessionKey string, sess *IngestSession, attempts int) error {
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "cleanup")
	entryKey := publishPrefix(tourID) + "index.html"
	var err error
	if sess.SaveBackupZip {
		err = CleanupAfterBackup(ctx, cfg.AdminR2Client, cfg.Ingest, sessionKey, sess.BackupKey, sess.ZipPath, entryKey, attempts)
	} else {
		err = CleanupWithoutBackup(ctx, cfg.AdminR2Client, cfg.Ingest, sessionKey, sess.ZipPath, entryKey)
	}
	if err != nil {
		return err
	}
	if err := cfg.WorkerClient.ArtifactMarkCompleted(tourID, ArtifactTourAdmin); err != nil {
		return fmt.Errorf("notify completed: %w", err)
	}
	return nil
}
