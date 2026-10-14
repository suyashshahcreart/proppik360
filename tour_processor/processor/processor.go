// Package processor implements the full ZIP processing pipeline.
//
// RunJob orchestrates:
//   1. Fetch tour metadata + presigned download URL from Worker API
//   2. Stream-download the ZIP to temp disk
//   3. Open ZIP, analyze stats, detect format, calculate concurrency
//   4. Build upload task list (strip internal folder prefix if needed)
//   5. Run worker pool — concurrent upload to R2
//   6. Build viewer URL for the extracted index.html
//   7. Notify Worker: complete (with viewerURL) or fail (with error message)
//   8. Clean up temp file
package processor

import (
	"archive/zip"
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"tour-processor/api"
	"tour-processor/r2"
)

// JobConfig is the runtime configuration injected at service start.
type JobConfig struct {
	WorkerClient *api.Client
	R2Client     *r2.Client
	R2BucketName string
	R2PublicDomain string
	TempDir      string

	// UploadLimiter caps concurrent R2 upload requests GLOBALLY, across
	// every tour being processed at once (fixed or adaptive AIMD).
	UploadLimiter *UploadLimiter

	// DownloadSemaphore caps concurrent range-fetch requests GLOBALLY, across
	// every tour's download at once — the download-side mirror of UploadLimiter.
	DownloadSemaphore *Semaphore

	// DownloadConcurrency is how many parallel Range chunks to use when
	// downloading a ZIP from R2. 1 disables ranged downloads.
	DownloadConcurrency int
}

// RunJob processes a single tour ZIP end-to-end.
// tourID is the D1 tour UUID received from the Worker webhook.
func RunJob(ctx context.Context, cfg JobConfig, tourID string) {
	start := time.Now()
	log.Printf("[job:%s] Started", tourID)

	if err := runJob(ctx, cfg, tourID); err != nil {
		log.Printf("[job:%s] FAILED after %s: %v", tourID, time.Since(start), err)

		if notifyErr := cfg.WorkerClient.Fail(tourID, err.Error()); notifyErr != nil {
			log.Printf("[job:%s] Also failed to notify worker of failure: %v", tourID, notifyErr)
		}
		return
	}

	log.Printf("[job:%s] Completed successfully in %s", tourID, time.Since(start))
}

// runJob contains the core logic; errors are returned to RunJob for consistent fail-notify.
func runJob(ctx context.Context, cfg JobConfig, tourID string) error {
	// ── Step 1: Fetch tour + download URL ────────────────────────
	log.Printf("[job:%s] Fetching tour metadata from Worker", tourID)
	tourData, err := cfg.WorkerClient.GetTour(tourID)
	if err != nil {
		return fmt.Errorf("GetTour: %w", err)
	}

	log.Printf("[job:%s] Tour=%q R2Key=%s FileSize=%d status=%s",
		tourID, tourData.Tour.Name, tourData.Tour.R2Key, tourData.Tour.FileSize, tourData.Tour.Status)

	// Idempotent: if Worker already marked ready, skip re-processing.
	if tourData.Tour.Status == "ready" {
		log.Printf("[job:%s] Tour already ready — skipping", tourID)
		return nil
	}
	if tourData.Tour.Status == "archived" || tourData.Tour.Status == "draft" {
		return fmt.Errorf("tour status %q is not processable", tourData.Tour.Status)
	}
	if tourData.Tour.Status == "uploading" {
		return fmt.Errorf("tour still uploading — ZIP not finalized")
	}

	// ── Step 2: Download ZIP to temp disk ─────────────────────────
	log.Printf("[job:%s] Downloading ZIP to temp disk", tourID)
	if err := cfg.WorkerClient.SetStage(tourID, "downloading"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}
	zipPath, err := DownloadZIP(tourData.DownloadURL, cfg.TempDir, tourID, cfg.DownloadConcurrency, cfg.DownloadSemaphore)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	// Always clean up the downloaded ZIP
	defer func() {
		log.Printf("[job:%s] Cleaning up temp file %s", tourID, zipPath)
		removeFile(zipPath)
	}()

	// ── Step 3: Open ZIP and analyze ─────────────────────────────
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

	log.Printf("[job:%s] Stats: files=%d totalBytes=%d largestFile=%d",
		tourID, stats.FileCount, stats.TotalBytes, stats.LargestFile)
	log.Printf("[job:%s] Config: concurrency=%d partSize=%dMB format=%s stripPrefix=%q",
		tourID, procCfg.Concurrency, procCfg.PartSizeBytes/MB, format, stripPrefix)

	// ── Step 4: Build upload tasks ───────────────────────────────
	r2Prefix := tourID + "/viewer/"
	tasks := BuildUploadTasks(files, r2Prefix, stripPrefix)
	log.Printf("[job:%s] Built %d upload tasks (prefix=%s)", tourID, len(tasks), r2Prefix)

	// Send initial progress ping so the Worker knows the totals immediately.
	// This lets the frontend show "0 / N files" as soon as processing starts.
	totalUploadBytes := computeTotalBytes(tasks)
	if err := cfg.WorkerClient.Progress(tourID, 0, len(tasks), 0, totalUploadBytes, "uploading_assets"); err != nil {
		log.Printf("[job:%s] initial progress ping failed (non-fatal): %v", tourID, err)
	}

	// ── Step 5: Run worker pool ──────────────────────────────────
	limit := 0
	if cfg.UploadLimiter != nil {
		limit = cfg.UploadLimiter.Limit()
	}
	log.Printf("[job:%s] Starting upload worker pool (concurrency=%d, global cap=%d)",
		tourID, procCfg.Concurrency, limit)
	result := RunWorkerPool(ctx, cfg.R2Client, tasks, procCfg.Concurrency, procCfg.PartSizeBytes, tourID, cfg.TempDir, cfg.WorkerClient, cfg.UploadLimiter, "uploading_assets")

	if result.Failed > 0 {
		// Collect first 5 errors for the failure message
		var errMsgs []string
		limit := 5
		if len(result.Errors) < limit {
			limit = len(result.Errors)
		}
		for _, e := range result.Errors[:limit] {
			errMsgs = append(errMsgs, e.Error())
		}
		return fmt.Errorf("%d/%d files failed to upload: %s",
			result.Failed, len(tasks), strings.Join(errMsgs, "; "))
	}

	// ── Step 6: Build viewer URL ─────────────────────────────────
	entryPoint := EntryPointFile(format)
	viewerURL := buildViewerURL(cfg.R2PublicDomain, cfg.R2BucketName, r2Prefix, entryPoint)
	if viewerURL == "" {
		return fmt.Errorf("R2_PUBLIC_DOMAIN is not configured — files were uploaded to %s but no public viewer URL could be built", r2Prefix)
	}
	log.Printf("[job:%s] Viewer URL: %s", tourID, viewerURL)
	if err := cfg.WorkerClient.SetStage(tourID, "finalizing"); err != nil {
		log.Printf("[job:%s] stage ping failed (non-fatal): %v", tourID, err)
	}

	// ── Step 7: Notify Worker — complete ─────────────────────────
	if err := cfg.WorkerClient.Complete(tourID, viewerURL, ""); err != nil {
		return fmt.Errorf("notify complete: %w", err)
	}

	return nil
}

// buildViewerURL constructs the public R2 URL for the tour viewer.
//
// IMPORTANT: R2 public bucket URLs always use a random "pub-xxxxx.r2.dev"
// subdomain assigned by Cloudflare when you enable public access — NOT
// "{bucketName}.r2.dev". There is no valid fallback if R2PublicDomain is
// unset, so we return an empty string and let the caller treat it as an error.
func buildViewerURL(r2PublicDomain, _bucketName, r2Prefix, entryPoint string) string {
	if r2PublicDomain == "" || r2PublicDomain == "YOUR_R2_PUBLIC_DOMAIN_HERE" {
		return ""
	}
	return fmt.Sprintf("https://%s/%s%s", r2PublicDomain, r2Prefix, entryPoint)
}

func removeFile(path string) {
	if err := removeFileSafe(path); err != nil {
		log.Printf("[cleanup] Failed to remove %s: %v", path, err)
	}
}
