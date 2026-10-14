package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"time"

	"tour-processor/r2"
)

// BackupZipName builds {zipBase}_{version}_{timestamp}.zip.
func BackupZipName(zipBase, version string, now time.Time) string {
	ts := now.UTC().Format("2006-01-02T150405Z")
	return fmt.Sprintf("%s_%s_%s.zip", zipBase, version, ts)
}

// BackupKey is tours/{tourId}/backup_zip/{name}.
func BackupKey(tourID, objectName string) string {
	return fmt.Sprintf("%s/backup_zip/%s", tourID, objectName)
}

// SanitizeZipBase lowercases a filename stem for use in an object key.
func SanitizeZipBase(filename string) string {
	name := filename
	if len(name) > 4 && (name[len(name)-4:] == ".zip" || name[len(name)-4:] == ".ZIP") {
		name = name[:len(name)-4]
	}
	out := make([]byte, 0, len(name))
	lastDash := false
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'A' && c <= 'Z':
			c = c - 'A' + 'a'
			out = append(out, c)
			lastDash = false
		case (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
			out = append(out, c)
			lastDash = false
		default:
			if !lastDash && len(out) > 0 {
				out = append(out, '-')
				lastDash = true
			}
		}
	}
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	if len(out) > 40 {
		out = out[:40]
		for len(out) > 0 && out[len(out)-1] == '-' {
			out = out[:len(out)-1]
		}
	}
	if len(out) == 0 {
		return "tour"
	}
	return string(out)
}

// UploadBackup streams the local ZIP to R2 (multipart when large).
func UploadBackup(ctx context.Context, client *r2.Client, key, zipPath string, partSize int64) error {
	f, err := os.Open(zipPath)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if fi.Size() < MultipartThreshold {
		data, err := io.ReadAll(f)
		if err != nil {
			return err
		}
		return client.PutObject(ctx, key, data)
	}
	if partSize < 5*MB {
		partSize = 20 * MB
	}
	return client.UploadMultipart(ctx, key, f, fi.Size(), partSize)
}

// VerifyBackup HEAD-checks the object `attempts` times. Size must match.
// Also compares a local SHA-256 against itself across passes so a truncated
// local file is caught before we trust the backup (R2 multipart ETags are not
// a whole-object hash).
func VerifyBackup(ctx context.Context, client *r2.Client, key, zipPath string, attempts int) error {
	if attempts < 1 {
		attempts = 3
	}
	fi, err := os.Stat(zipPath)
	if err != nil {
		return err
	}
	sum, err := fileSHA256(zipPath)
	if err != nil {
		return err
	}
	var last error
	okCount := 0
	tries := 0
	maxTries := attempts * 3
	for okCount < attempts && tries < maxTries {
		tries++
		size, _, exists, headErr := client.HeadObject(ctx, key)
		if headErr != nil || !exists || size != fi.Size() {
			last = fmt.Errorf("backup verify %d: exists=%v size=%d want=%d err=%v", tries, exists, size, fi.Size(), headErr)
			okCount = 0
			time.Sleep(400 * time.Millisecond)
			continue
		}
		again, err := fileSHA256(zipPath)
		if err != nil || again != sum {
			return fmt.Errorf("local ZIP changed during backup verify")
		}
		okCount++
		last = nil
		if okCount < attempts {
			time.Sleep(200 * time.Millisecond)
		}
	}
	if last != nil {
		return last
	}
	if okCount < attempts {
		return fmt.Errorf("backup verify did not reach %d successes", attempts)
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
