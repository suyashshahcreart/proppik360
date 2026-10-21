package processor

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"tour-processor/api"
	"tour-processor/r2"
)

// MaxRetries is the number of times a single upload task is retried on failure.
const MaxRetries = 3

// PoolResult holds the result of running the worker pool.
type PoolResult struct {
	Uploaded int
	Failed   int
	Errors   []error
}

// RunWorkerPool runs tasks concurrently using a fixed goroutine pool.
// Each failed task is retried up to MaxRetries times with exponential backoff.
//
// tourID and workerClient enable live progress reporting back to the Worker API
// every ~2 seconds via a background ticker goroutine.
//
// uploadLimiter gates the ACTUAL upload request (not goroutine startup) so that
// when multiple tours process concurrently (via JobQueue), the total number
// of in-flight R2 requests across ALL of them stays bounded — and can move
// up/down under adaptive AIMD.
//
// concurrency: number of goroutines for THIS job (cheap — they just wait on
//
//	the limiter when the system-wide cap is already saturated)
//
// partSize: multipart part size in bytes
// Returns a PoolResult with per-task outcomes.
func RunWorkerPool(
	ctx context.Context,
	client *r2.Client,
	tasks []UploadTask,
	concurrency int,
	partSize int64,
	tourID string,
	tempDir string,
	workerClient *api.Client,
	uploadLimiter *UploadLimiter,
	progressStage string,
) PoolResult {
	taskCh := make(chan UploadTask, len(tasks))
	for _, t := range tasks {
		taskCh <- t
	}
	close(taskCh)

	var (
		mu          sync.Mutex
		result      PoolResult
		wg          sync.WaitGroup
		fileCounter int64 // atomic: files uploaded so far
		byteCounter int64 // atomic: bytes uploaded so far
		totalFiles  = int64(len(tasks))
		totalBytes  = computeTotalBytes(tasks)
	)

	if progressStage == "" {
		progressStage = "uploading_assets"
	}
	limit := 0
	if uploadLimiter != nil {
		limit = uploadLimiter.Limit()
	}
	log.Printf("[pool] Starting %d workers for %d tasks (%.1f MB total, globalLimit=%d)",
		concurrency, totalFiles, float64(totalBytes)/1024/1024, limit)

	// ── Ticker goroutine: report progress to Worker every 2s ─────────────
	tickerDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-tickerDone:
				return
			case <-ticker.C:
				cf := int(atomic.LoadInt64(&fileCounter))
				cb := atomic.LoadInt64(&byteCounter)
				if workerClient != nil {
					if err := workerClient.Progress(tourID, cf, int(totalFiles), cb, totalBytes, progressStage); err != nil {
						log.Printf("[pool] progress ping failed (non-fatal): %v", err)
					}
				}
			}
		}
	}()

	// ── Worker goroutines ─────────────────────────────────────────────────
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			for task := range taskCh {
				// Wait for a GLOBAL slot before making the actual R2 request.
				if uploadLimiter != nil {
					uploadLimiter.Acquire()
				}
				err := uploadWithRetry(ctx, client, task, partSize, tempDir, uploadLimiter)
				if uploadLimiter != nil {
					uploadLimiter.Release()
				}

				cf := atomic.AddInt64(&fileCounter, 1)
				if shouldLogUploadProgress(cf, totalFiles) {
					gl := 0
					if uploadLimiter != nil {
						gl = uploadLimiter.Limit()
					}
					log.Printf("[pool] Progress: %d/%d files uploaded (%.0f%%) globalLimit=%d",
						cf, totalFiles, float64(cf)*100/float64(totalFiles), gl)
				}

				mu.Lock()
				if err != nil {
					result.Failed++
					result.Errors = append(result.Errors, fmt.Errorf("%s: %w", task.R2Key, err))
					log.Printf("[pool] worker=%d FAILED %s: %v", workerID, task.R2Key, err)
				} else {
					result.Uploaded++
					// Bump byte counter only on success so the Worker's
					// progress_current_bytes always reflects verified uploads.
					atomic.AddInt64(&byteCounter, task.FileSize)
				}
				mu.Unlock()
			}
		}(i + 1)
	}

	wg.Wait()

	// Stop ticker and send one final progress ping with accurate numbers
	close(tickerDone)
	cf := int(atomic.LoadInt64(&fileCounter))
	cb := atomic.LoadInt64(&byteCounter)
	if err := workerClient.Progress(tourID, cf, int(totalFiles), cb, totalBytes, progressStage); err != nil {
		log.Printf("[pool] final progress ping failed (non-fatal): %v", err)
	}

	log.Printf("[pool] Done — uploaded=%d failed=%d", result.Uploaded, result.Failed)
	return result
}

// computeTotalBytes sums all task file sizes. Used once at pool start.
func computeTotalBytes(tasks []UploadTask) int64 {
	var total int64
	for _, t := range tasks {
		total += t.FileSize
	}
	return total
}

// uploadWithRetry wraps UploadFile with exponential backoff retry.
func shouldLogUploadProgress(done, total int64) bool {
	if done == total {
		return true
	}
	if total <= 100 {
		return done%10 == 0
	}
	return done%100 == 0
}

func uploadWithRetry(
	ctx context.Context,
	client *r2.Client,
	task UploadTask,
	partSize int64,
	tempDir string,
	limiter *UploadLimiter,
) error {
	var lastErr error

	for attempt := 1; attempt <= MaxRetries; attempt++ {
		if err := UploadFile(ctx, client, task, partSize, tempDir); err != nil {
			lastErr = err
			if limiter != nil {
				limiter.RecordFailure()
			}
			if attempt < MaxRetries {
				backoff := time.Duration(attempt*attempt) * time.Second // 1s, 4s
				log.Printf("[pool] Retry %d/%d for %s (backoff=%s): %v",
					attempt, MaxRetries, task.R2Key, backoff, err)
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(backoff):
				}
			}
			continue
		}
		if limiter != nil {
			limiter.RecordSuccess(task.FileSize)
		}
		return nil // success
	}

	return fmt.Errorf("after %d attempts: %w", MaxRetries, lastErr)
}
