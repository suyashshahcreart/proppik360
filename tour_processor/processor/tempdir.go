package processor

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultTempMaxAge = 24 * time.Hour

// tempFilePatterns are removed by CleanupStaleFiles when older than maxAge,
// and entirely on processor startup (orphaned from a previous process).
var tempFilePatterns = []string{"*.zip", "r2upload-*.tmp"}

// EnsureTempDir creates the processor temp directory if missing.
func EnsureTempDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("temp dir is empty")
	}
	return os.MkdirAll(dir, 0o755)
}

// CleanupOrphanedTempFiles removes leftover ZIPs and multipart staging files
// from a previous processor run. Safe on startup because no in-process jobs exist yet.
func CleanupOrphanedTempFiles(dir string) (removed int, freedBytes int64) {
	n, b, err := cleanupTempFiles(dir, tempFilePatterns, 0)
	if err != nil {
		log.Printf("[cleanup] Startup temp cleanup in %s failed: %v", dir, err)
		return 0, 0
	}
	if n > 0 {
		log.Printf("[cleanup] Removed %d orphaned temp file(s), freed %.1f MB in %s",
			n, float64(b)/1024/1024, dir)
	}
	return n, b
}

// CleanupStaleTempFiles removes temp files older than maxAge (for periodic maintenance).
func CleanupStaleTempFiles(dir string, maxAge time.Duration) (removed int, freedBytes int64, err error) {
	if maxAge <= 0 {
		maxAge = defaultTempMaxAge
	}
	return cleanupTempFiles(dir, tempFilePatterns, maxAge)
}

func cleanupTempFiles(dir string, patterns []string, maxAge time.Duration) (removed int, freedBytes int64, err error) {
	if dir == "" {
		return 0, 0, nil
	}
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if !info.IsDir() {
		return 0, 0, fmt.Errorf("%s is not a directory", dir)
	}

	cutoff := time.Time{}
	if maxAge > 0 {
		cutoff = time.Now().Add(-maxAge)
	}

	for _, pattern := range patterns {
		matches, globErr := filepath.Glob(filepath.Join(dir, pattern))
		if globErr != nil {
			return removed, freedBytes, globErr
		}
		for _, path := range matches {
			fi, statErr := os.Stat(path)
			if statErr != nil {
				if os.IsNotExist(statErr) {
					continue
				}
				log.Printf("[cleanup] Skip %s: %v", path, statErr)
				continue
			}
			if fi.IsDir() {
				continue
			}
			if !cutoff.IsZero() && fi.ModTime().After(cutoff) {
				continue
			}
			if strings.HasSuffix(strings.ToLower(path), ".zip") {
				id := strings.TrimSuffix(filepath.Base(path), ".zip")
				if _, sessErr := os.Stat(filepath.Join(dir, "sessions", id+".json")); sessErr == nil {
					continue
				}
			}
			size := fi.Size()
			if rmErr := os.Remove(path); rmErr != nil {
				log.Printf("[cleanup] Failed to remove %s: %v", path, rmErr)
				continue
			}
			removed++
			freedBytes += size
		}
	}
	return removed, freedBytes, nil
}

// CreateMultipartTempFile creates a seekable staging file for large ZIP entries.
func CreateMultipartTempFile(tempDir, tourID, zipEntryName string) (*os.File, error) {
	if err := EnsureTempDir(tempDir); err != nil {
		return nil, err
	}
	prefix := sanitizeTempPrefix(tourID) + "-"
	tmp, err := os.CreateTemp(tempDir, prefix+"r2upload-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("create temp file for %s: %w", zipEntryName, err)
	}
	return tmp, nil
}

func sanitizeTempPrefix(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return -1
		}
	}, s)
	if s == "" {
		return "tour"
	}
	if len(s) > 32 {
		return s[:32]
	}
	return s
}
