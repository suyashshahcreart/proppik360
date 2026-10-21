package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/joho/godotenv"

	"tour-processor/api"
	"tour-processor/config"
	"tour-processor/processor"
	"tour-processor/r2"
	"tour-processor/server"
)

func main() {
	// Load .env (silently ignore missing file in production where env vars come from the OS)
	if err := godotenv.Load(); err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[main] Warning: could not load .env: %v", err)
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[main] Configuration error: %v", err)
	}

	if err := processor.EnsureTempDir(cfg.TempDir); err != nil {
		log.Fatalf("[main] Temp dir error: %v", err)
	}
	processor.CleanupOrphanedTempFiles(cfg.TempDir)

	// Build R2 client (viewer / tour ZIP)
	r2Client := r2.New(r2.Config{
		AccountID:       cfg.R2AccountID,
		BucketName:      cfg.R2BucketName,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
	})

	var adminR2Client *r2.Client
	if cfg.R2AdminBucketName != "" {
		adminR2Client = r2.New(r2.Config{
			AccountID:       cfg.R2AccountID,
			BucketName:      cfg.R2AdminBucketName,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
		})
	}

	// Build Worker API client
	workerClient := api.NewClient(cfg.WorkerAPIURL, cfg.ProcessorSecret)

	// Global gates — cap concurrent R2 requests across ALL jobs, separately
	// for uploads (adaptive AIMD) and downloads (fixed semaphore).
	uploadLimiter := processor.NewUploadLimiter(cfg.UploadLimiter)
	downloadSem := processor.NewSemaphore(cfg.MaxGlobalDownloadConcurrency)

	ingest := processor.NewIngestStore(cfg.TempDir)

	// Assemble job config (shared across all jobs) — includes optional admin bucket.
	jobCfg := processor.AdminPipelineConfig{
		PipelineConfig: processor.PipelineConfig{
			JobConfig: processor.JobConfig{
				WorkerClient:        workerClient,
				R2Client:            r2Client,
				R2BucketName:        cfg.R2BucketName,
				R2PublicDomain:      cfg.R2PublicDomain,
				TempDir:             cfg.TempDir,
				UploadLimiter:       uploadLimiter,
				DownloadSemaphore:   downloadSem,
				DownloadConcurrency: cfg.DownloadConcurrency,
			},
			Ingest:               ingest,
			BackupVerifyAttempts: cfg.BackupVerifyAttempts,
		},
		AdminR2Client:     adminR2Client,
		AdminR2BucketName: cfg.R2AdminBucketName,
		AdminPublicDomain: cfg.R2AdminPublicDomain,
	}

	// Job queue — caps how many tours process at the same time.
	// Extra tours wait in the queue until a slot frees up.
	jobQueue := processor.NewJobQueue(cfg.MaxConcurrentJobs, cfg.MaxConcurrentJobs*4, jobCfg)

	// On startup: ask Worker to reconcile stuck tours, then pull pending jobs.
	// This recovers work lost while this process (or the network) was down.
	go resumePendingJobs(workerClient, jobQueue)

	// Start HTTP server
	srv := server.New(cfg.ProcessorSecret, jobQueue, ingest)
	addr := cfg.ServerAddr()

	log.Printf("[main] Tour Processor starting on %s", addr)
	log.Printf("[main] Worker API: %s", cfg.WorkerAPIURL)
	log.Printf("[main] R2 Bucket:  %s", cfg.R2BucketName)
	if cfg.R2AdminBucketName != "" {
		log.Printf("[main] Admin R2:  %s (domain=%s)", cfg.R2AdminBucketName, cfg.R2AdminPublicDomain)
	}
	log.Printf("[main] Temp Dir:   %s", cfg.TempDir)
	log.Printf("[main] Max concurrent jobs: %d | Upload limiter mode=%s start/limit=%d (min=%d max=%d hard=%d budget=%d%%) | Global download concurrency: %d | Download chunks/job: %d",
		cfg.MaxConcurrentJobs,
		cfg.UploadLimiter.Mode,
		uploadLimiter.Limit(),
		cfg.UploadLimiter.Min,
		cfg.UploadLimiter.Max,
		cfg.UploadLimiter.HardMax,
		cfg.UploadLimiter.BudgetPercent,
		cfg.MaxGlobalDownloadConcurrency,
		cfg.DownloadConcurrency,
	)

	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatalf("[main] ListenAndServe: %v", err)
	}
}

// resumePendingJobs runs once at boot (and a short delayed retry) so pending
// Worker-side tours are re-queued after processor restarts / outages.
func resumePendingJobs(workerClient *api.Client, jobQueue *processor.JobQueue) {
	attempt := func(label string) {
		if err := workerClient.Reconcile(); err != nil {
			log.Printf("[main] %s reconcile failed: %v", label, err)
		} else {
			log.Printf("[main] %s reconcile ok", label)
		}

		pending, err := workerClient.ListPending()
		if err != nil {
			log.Printf("[main] %s list pending failed: %v", label, err)
			return
		}
		if len(pending) == 0 {
			log.Printf("[main] %s no pending tours", label)
			return
		}
		log.Printf("[main] %s enqueueing %d pending tour(s)", label, len(pending))
		for _, t := range pending {
			jobQueue.Enqueue(t.ID)
		}
	}

	attempt("startup")
	// Second pass after Worker/network may have come up a few seconds later.
	time.Sleep(15 * time.Second)
	attempt("startup-retry")

	// Periodic pull every 2 minutes as a safety net alongside Worker cron.
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		attempt("periodic")
	}
}
