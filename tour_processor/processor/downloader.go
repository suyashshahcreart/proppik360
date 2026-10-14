package processor

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DownloadZIP streams a ZIP file from a presigned URL to a local temp file.
// Returns the path to the downloaded file. Caller is responsible for deleting it.
//
// When concurrency > 1 and the server supports HTTP Range requests (R2/S3
// GET presigned URLs do), the file is downloaded as N parallel byte-range
// chunks written directly to their offsets — similar to a download manager.
// A single TCP stream often can't saturate available bandwidth, especially
// on higher-latency connections, so this can substantially cut download time
// for large ZIPs (multi-hundred-MB to multi-GB). Falls back automatically to
// a single-stream download if ranging isn't supported or a chunk fails.
//
// globalSem gates every actual range/stream request against the GLOBAL
// download semaphore, shared across every tour's download at once — this is
// what prevents multiple concurrent jobs from opening uncoordinated bursts
// of download connections that fight over the same bandwidth (mirrors how
// UploadSemaphore protects the upload phase in worker_pool.go).
func DownloadZIP(presignedURL, tempDir, tourID string, concurrency int, globalSem *Semaphore) (string, error) {
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}

	destPath := filepath.Join(tempDir, tourID+".zip")

	if concurrency > 1 {
		if size, ok := probeRangeSupport(presignedURL); ok && size > 0 {
			if err := downloadParallel(presignedURL, destPath, size, concurrency, globalSem); err == nil {
				log.Printf("[downloader] Downloaded %d bytes (parallel x%d) → %s", size, concurrency, destPath)
				return destPath, nil
			} else {
				log.Printf("[downloader] Parallel download failed (%v) — falling back to single-stream", err)
				os.Remove(destPath)
			}
		}
	}

	return downloadSingleStream(presignedURL, destPath, globalSem)
}

// probeRangeSupport issues a 1-byte Range request to check whether the
// server honors Range requests and to learn the total object size from the
// Content-Range response header, without downloading the whole file first.
func probeRangeSupport(url string) (int64, bool) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("Range", "bytes=0-0")

	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusPartialContent {
		return 0, false
	}

	// Expected format: "Content-Range: bytes 0-0/123456"
	cr := resp.Header.Get("Content-Range")
	idx := strings.LastIndex(cr, "/")
	if idx == -1 || idx+1 >= len(cr) {
		return 0, false
	}
	total, err := strconv.ParseInt(cr[idx+1:], 10, 64)
	if err != nil || total <= 0 {
		return 0, false
	}
	return total, true
}

// downloadParallel splits [0, size) into up to `concurrency` byte ranges and
// downloads them concurrently, writing each chunk directly to its offset in
// the pre-allocated destination file. Any chunk failing after its retries
// aborts the whole download so the caller can fall back to single-stream.
func downloadParallel(url, destPath string, size int64, concurrency int, globalSem *Semaphore) error {
	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create temp file %s: %w", destPath, err)
	}
	defer f.Close()

	if err := f.Truncate(size); err != nil {
		return fmt.Errorf("preallocate temp file: %w", err)
	}

	const minChunkSize = 8 * MB
	chunkSize := size / int64(concurrency)
	if chunkSize < minChunkSize {
		chunkSize = size // too small to benefit from splitting — one range covering everything
	}

	type chunkRange struct{ start, end int64 } // inclusive
	var ranges []chunkRange
	for start := int64(0); start < size; start += chunkSize {
		end := start + chunkSize - 1
		if end >= size {
			end = size - 1
		}
		ranges = append(ranges, chunkRange{start, end})
	}

	client := &http.Client{Timeout: 2 * time.Hour}

	var wg sync.WaitGroup
	errCh := make(chan error, len(ranges))

	for _, rg := range ranges {
		wg.Add(1)
		go func(rg chunkRange) {
			defer wg.Done()
			// Wait for a GLOBAL download slot before making the actual
			// request — the goroutine itself is cheap; the network request
			// is the scarce resource shared across every tour downloading.
			globalSem.Acquire()
			err := downloadRangeWithRetry(client, url, f, rg.start, rg.end)
			globalSem.Release()
			if err != nil {
				errCh <- err
			}
		}(rg)
	}

	wg.Wait()
	close(errCh)

	for err := range errCh {
		if err != nil {
			return err
		}
	}
	return nil
}

// downloadRangeWithRetry fetches byte range [start, end] with one retry on failure.
func downloadRangeWithRetry(client *http.Client, url string, f *os.File, start, end int64) error {
	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		if err := downloadRange(client, url, f, start, end); err != nil {
			lastErr = err
			time.Sleep(time.Second)
			continue
		}
		return nil
	}
	return fmt.Errorf("range %d-%d failed after retries: %w", start, end, lastErr)
}

// downloadRange fetches byte range [start, end] (inclusive) and writes it to
// the file at the matching offset via io.OffsetWriter.
func downloadRange(client *http.Client, url string, f *os.File, start, end int64) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("range %d-%d: %w", start, end, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("range %d-%d: expected HTTP 206, got %d", start, end, resp.StatusCode)
	}

	sw := io.NewOffsetWriter(f, start)
	if _, err := io.Copy(sw, resp.Body); err != nil {
		return fmt.Errorf("range %d-%d: write: %w", start, end, err)
	}
	return nil
}

// downloadSingleStream is the original single-connection download path, used
// as a fallback when ranged downloads aren't supported or DOWNLOAD_CONCURRENCY=1.
func downloadSingleStream(presignedURL, destPath string, globalSem *Semaphore) (string, error) {
	client := &http.Client{
		Timeout: 2 * time.Hour, // large ZIPs can take a long time on slow VPS uplinks
	}

	// Same global download slot as ranged chunks — a single-stream download
	// still competes for the same bandwidth as everything else in flight.
	globalSem.Acquire()
	defer globalSem.Release()

	resp, err := client.Get(presignedURL)
	if err != nil {
		return "", fmt.Errorf("GET presigned URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download ZIP: HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("create temp file %s: %w", destPath, err)
	}
	defer f.Close()

	written, err := io.Copy(f, resp.Body)
	if err != nil {
		os.Remove(destPath)
		return "", fmt.Errorf("stream to disk: %w", err)
	}

	log.Printf("[downloader] Downloaded %d bytes (single-stream) → %s", written, destPath)
	return destPath, nil
}
