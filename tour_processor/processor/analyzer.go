package processor

import (
	"archive/zip"
	"fmt"
)

const (
	KB int64 = 1024
	MB int64 = 1024 * KB
	GB int64 = 1024 * MB

	// MultipartThreshold is the minimum file size to use multipart upload.
	// R2/S3 requires parts to be at least 5 MB except the last part.
	MultipartThreshold = 5 * MB
)

// ProcessingConfig holds the concurrency and part size calculated from ZIP analysis.
type ProcessingConfig struct {
	// Concurrency is the number of goroutines in the upload worker pool.
	Concurrency int

	// PartSizeBytes is the size of each part for multipart uploads of large files.
	PartSizeBytes int64
}

// ZIPStats holds statistics about the ZIP contents.
type ZIPStats struct {
	FileCount   int
	TotalBytes  int64 // sum of uncompressed sizes
	LargestFile int64 // largest single file uncompressed size
}

// AnalyzeZIP opens the ZIP and collects stats without extracting anything.
func AnalyzeZIP(zipPath string) (*ZIPStats, []*zip.File, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, nil, fmt.Errorf("open ZIP: %w", err)
	}
	// Note: we do NOT close the reader here — the caller uses the files.
	// The caller must close the zip.ReadCloser when done.

	var stats ZIPStats
	var files []*zip.File

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		stats.FileCount++
		size := int64(f.UncompressedSize64)
		stats.TotalBytes += size
		if size > stats.LargestFile {
			stats.LargestFile = size
		}
		files = append(files, f)
	}

	return &stats, files, nil
}

// AnalyzeZIPReader is like AnalyzeZIP but takes an already-open reader.
func AnalyzeZIPReader(r *zip.ReadCloser) (*ZIPStats, []*zip.File) {
	var stats ZIPStats
	var files []*zip.File

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		stats.FileCount++
		size := int64(f.UncompressedSize64)
		stats.TotalBytes += size
		if size > stats.LargestFile {
			stats.LargestFile = size
		}
		files = append(files, f)
	}

	return &stats, files
}

// CalcConfig determines the optimal per-job goroutine count and multipart
// part size based on the ZIP's file count and total uncompressed size.
//
// Concurrency and part size are calculated independently:
//   - Concurrency depends on FILE COUNT (+ average file size). Many-small-file
//     ZIPs (e.g. panorama tile sets) are latency-bound — each file is a full
//     HTTP round trip — so they need far more parallel requests in flight
//     than a byte-count-only heuristic would suggest.
//   - Part size depends on TOTAL BYTES, since it only affects how individual
//     large files (e.g. videos) get chunked for multipart upload.
//
// NOTE: the actual number of SIMULTANEOUS R2 requests system-wide is capped
// by the global upload semaphore (MAX_GLOBAL_UPLOAD_CONCURRENCY env var),
// shared across every tour the JobQueue is currently running. Per-job
// concurrency here only needs to be high enough that a single large tour can
// saturate that global cap on its own — extra goroutines beyond the global
// cap just wait cheaply on the semaphore, so it's safe to be generous.
func CalcConfig(stats *ZIPStats) ProcessingConfig {
	var avgFileSize int64
	if stats.FileCount > 0 {
		avgFileSize = stats.TotalBytes / int64(stats.FileCount)
	}

	concurrency := baseConcurrency(stats.FileCount)

	// Many-tiny-files workloads are latency-bound rather than bandwidth-bound —
	// push concurrency higher so more requests can be in flight at once.
	if avgFileSize > 0 && avgFileSize < 100*KB {
		concurrency = concurrency * 3 / 2 // +50%
	}

	// Ceiling deliberately set well above any expected MAX_GLOBAL_UPLOAD_CONCURRENCY
	// value. If this were ever LOWER than the global semaphore size, a single big
	// tour could never actually reach the global cap on its own — the per-job
	// goroutine count would be the binding constraint instead of the semaphore.
	const concurrencyCeiling = 500
	if concurrency > concurrencyCeiling {
		concurrency = concurrencyCeiling
	}

	return ProcessingConfig{
		Concurrency:   concurrency,
		PartSizeBytes: partSizeFor(stats.TotalBytes),
	}
}

// baseConcurrency scales goroutine count with file count.
//   - Tiny   (<=50 files):     5
//   - Small  (<=200 files):    15
//   - Medium (<=1,000 files):  40
//   - Large  (<=10,000 files): 80
//   - XLarge (<=50,000 files): 150
//   - Huge   (>50,000 files):  400
func baseConcurrency(fileCount int) int {
	switch {
	case fileCount <= 50:
		return 5
	case fileCount <= 200:
		return 15
	case fileCount <= 1000:
		return 40
	case fileCount <= 10000:
		return 80
	case fileCount <= 50000:
		return 150
	default:
		return 400
	}
}

// partSizeFor scales multipart chunk size with total ZIP size.
func partSizeFor(totalBytes int64) int64 {
	switch {
	case totalBytes <= 50*MB:
		return 5 * MB
	case totalBytes <= 200*MB:
		return 10 * MB
	case totalBytes <= 1*GB:
		return 15 * MB
	default:
		return 20 * MB
	}
}
