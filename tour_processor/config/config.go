package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"tour-processor/processor"
)

// Config holds all runtime configuration for the processor service.
// Values are loaded from environment variables (populated from .env by main.go).
type Config struct {
	// Worker API
	WorkerAPIURL    string
	ProcessorSecret string

	// R2 S3-compatible API credentials
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicDomain    string // e.g. "pub-abc.r2.dev" — used to build viewer URLs

	// HTTP server
	Port string

	// Temp directory for downloaded ZIPs
	TempDir string

	// MaxConcurrentJobs caps how many tours can be processed at the same time.
	// Extra jobs wait in an internal queue until a slot frees up.
	MaxConcurrentJobs int

	// MaxGlobalUploadConcurrency is the fixed-mode cap (and adaptive START
	// fallback). Prefer UploadLimiter fields when mode=adaptive.
	MaxGlobalUploadConcurrency int

	// UploadLimiter drives global R2 publish concurrency (fixed or adaptive AIMD).
	UploadLimiter processor.UploadLimiterConfig

	// DownloadConcurrency is how many parallel HTTP Range requests are used
	// to download a single ZIP from R2. Set to 1 to disable ranged downloads.
	DownloadConcurrency int

	// MaxGlobalDownloadConcurrency caps the TOTAL number of concurrent range-fetch
	// requests across ALL jobs' downloads combined (mirrors MaxGlobalUploadConcurrency).
	MaxGlobalDownloadConcurrency int

	// BackupVerifyAttempts is how many successful HEAD checks a backup ZIP
	// must pass before Go deletes its temp copy.
	BackupVerifyAttempts int
}

// Load reads all required environment variables and returns a Config.
// Returns an error if any required variable is missing.
func Load() (*Config, error) {
	fixedUpload := getEnvInt("MAX_GLOBAL_UPLOAD_CONCURRENCY", 400)
	limiter := buildUploadLimiterConfig(fixedUpload)

	cfg := &Config{
		WorkerAPIURL:      getEnv("WORKER_API_URL", "http://localhost:8787"),
		ProcessorSecret:   getEnv("PROCESSOR_SECRET", ""),
		R2AccountID:       getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:      getEnv("R2_BUCKET_NAME", "tour-saas-uploads"),
		R2PublicDomain:    getEnv("R2_PUBLIC_DOMAIN", ""),
		Port:              getEnv("PORT", "9000"),
		TempDir:           getEnv("TEMP_DIR", os.TempDir()),

		MaxConcurrentJobs:            getEnvInt("MAX_CONCURRENT_JOBS", 5),
		MaxGlobalUploadConcurrency:   fixedUpload,
		UploadLimiter:                limiter,
		DownloadConcurrency:          getEnvInt("DOWNLOAD_CONCURRENCY", 8),
		MaxGlobalDownloadConcurrency: getEnvInt("MAX_GLOBAL_DOWNLOAD_CONCURRENCY", 24),
		BackupVerifyAttempts:         getEnvInt("BACKUP_VERIFY_ATTEMPTS", 3),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func buildUploadLimiterConfig(fixedUpload int) processor.UploadLimiterConfig {
	def := processor.DefaultUploadLimiterConfig()
	mode := strings.ToLower(strings.TrimSpace(getEnv("UPLOAD_CONCURRENCY_MODE", "adaptive")))

	cfg := processor.UploadLimiterConfig{
		Mode:           processor.UploadLimiterMode(mode),
		Min:            getEnvInt("UPLOAD_CONCURRENCY_MIN", def.Min),
		Max:            getEnvInt("UPLOAD_CONCURRENCY_MAX", def.Max),
		Start:          getEnvInt("UPLOAD_CONCURRENCY_START", 0),
		HardMax:        getEnvInt("UPLOAD_CONCURRENCY_HARD_MAX", def.HardMax),
		BudgetPercent:  getEnvInt("RESOURCE_BUDGET_PERCENT", def.BudgetPercent),
		Step:           getEnvInt("UPLOAD_CONCURRENCY_STEP", def.Step),
		Interval:       time.Duration(getEnvInt("UPLOAD_CONCURRENCY_INTERVAL_SEC", 3)) * time.Second,
		WorkersPerCore: def.WorkersPerCore,
	}

	// Machine profile presets (only fill gaps / soften local).
	switch strings.ToLower(strings.TrimSpace(getEnv("MACHINE_PROFILE", ""))) {
	case "local":
		if getEnv("UPLOAD_CONCURRENCY_MIN", "") == "" {
			cfg.Min = 50
		}
		if getEnv("UPLOAD_CONCURRENCY_MAX", "") == "" {
			cfg.Max = 250
		}
		if getEnv("UPLOAD_CONCURRENCY_START", "") == "" {
			cfg.Start = 120
		}
		if getEnv("UPLOAD_CONCURRENCY_HARD_MAX", "") == "" {
			cfg.HardMax = 400
		}
		if getEnv("RESOURCE_BUDGET_PERCENT", "") == "" {
			cfg.BudgetPercent = 60
		}
	case "kvm4":
		if getEnv("UPLOAD_CONCURRENCY_MAX", "") == "" {
			cfg.Max = 400
		}
		if getEnv("UPLOAD_CONCURRENCY_START", "") == "" {
			cfg.Start = 200
		}
		if getEnv("UPLOAD_CONCURRENCY_HARD_MAX", "") == "" {
			cfg.HardMax = 600
		}
	case "kvm8":
		// Defaults already match KVM8-oriented values.
	}

	if cfg.Start <= 0 {
		if mode == "fixed" {
			cfg.Start = fixedUpload
		} else {
			cfg.Start = def.Start
			// If operator only set MAX_GLOBAL_UPLOAD_CONCURRENCY, use it as start.
			if getEnv("UPLOAD_CONCURRENCY_START", "") == "" && fixedUpload > 0 {
				cfg.Start = fixedUpload
			}
		}
	}

	if mode == "fixed" {
		cfg.Mode = processor.UploadLimiterFixed
		cfg.Start = fixedUpload
	}

	return cfg
}

func (c *Config) validate() error {
	required := map[string]string{
		"PROCESSOR_SECRET":     c.ProcessorSecret,
		"R2_ACCOUNT_ID":        c.R2AccountID,
		"R2_ACCESS_KEY_ID":     c.R2AccessKeyID,
		"R2_SECRET_ACCESS_KEY": c.R2SecretAccessKey,
	}
	for name, val := range required {
		if val == "" {
			return fmt.Errorf("required environment variable %s is not set", name)
		}
	}
	return nil
}

// ServerAddr returns ":PORT" for net/http ListenAndServe.
func (c *Config) ServerAddr() string {
	if _, err := strconv.Atoi(c.Port); err != nil {
		return ":9000"
	}
	return ":" + c.Port
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}
