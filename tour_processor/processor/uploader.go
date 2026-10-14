package processor

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"tour-processor/r2"
)

// UploadTask represents a single file to upload from the ZIP to R2.
type UploadTask struct {
	ZipFile  *zip.File // source file inside the ZIP
	R2Key    string    // destination key in R2 bucket
	FileSize int64     // uncompressed size in bytes
}

// BuildUploadTasks creates a list of UploadTasks from ZIP files.
// r2Prefix is the key prefix in R2, e.g. "tours/abc123/".
// stripPrefix is the ZIP internal folder prefix to remove, e.g. "Avadhgreens/".
func BuildUploadTasks(files []*zip.File, r2Prefix, stripPrefix string) []UploadTask {
	tasks := make([]UploadTask, 0, len(files))

	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}

		// Normalize to forward slashes
		name := filepath.ToSlash(f.Name)

		// Strip common top-level folder from ZIP (e.g. "Avadhgreens/")
		if stripPrefix != "" {
			name = strings.TrimPrefix(name, stripPrefix)
		}

		// Skip hidden files and macOS metadata
		base := filepath.Base(name)
		if strings.HasPrefix(base, ".") || strings.HasPrefix(base, "__MACOSX") {
			continue
		}
		if strings.Contains(name, "__MACOSX") {
			continue
		}

		r2Key := r2Prefix + name

		tasks = append(tasks, UploadTask{
			ZipFile:  f,
			R2Key:    r2Key,
			FileSize: int64(f.UncompressedSize64),
		})
	}

	return tasks
}

// UploadFile uploads a single file from the ZIP to R2.
// It chooses between single PUT and multipart upload based on file size.
func UploadFile(ctx context.Context, client *r2.Client, task UploadTask, partSize int64, tempDir string) error {
	if task.FileSize >= MultipartThreshold {
		return uploadMultipart(ctx, client, task, partSize, tempDir)
	}
	return uploadSingle(ctx, client, task)
}

func taskTourID(task UploadTask) string {
	key := task.R2Key
	if strings.HasPrefix(key, "tours/") {
		key = strings.TrimPrefix(key, "tours/")
	}
	if idx := strings.IndexByte(key, '/'); idx > 0 {
		return key[:idx]
	}
	if key != "" {
		return key
	}
	return "tour"
}

// uploadSingle reads the whole file into memory and does a single PUT.
// Only used for files < MultipartThreshold (5 MB).
func uploadSingle(ctx context.Context, client *r2.Client, task UploadTask) error {
	rc, err := task.ZipFile.Open()
	if err != nil {
		return fmt.Errorf("open zip entry %s: %w", task.ZipFile.Name, err)
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		return fmt.Errorf("read zip entry %s: %w", task.ZipFile.Name, err)
	}

	return client.PutObject(ctx, task.R2Key, data)
}

// uploadMultipart streams from the ZIP entry to a temp file, then multipart-uploads.
// Streaming ZIP → temp file is required because multipart upload needs a seekable reader.
func uploadMultipart(ctx context.Context, client *r2.Client, task UploadTask, partSize int64, tempDir string) error {
	tmp, err := CreateMultipartTempFile(tempDir, taskTourID(task), task.ZipFile.Name)
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	rc, err := task.ZipFile.Open()
	if err != nil {
		return fmt.Errorf("open zip entry %s: %w", task.ZipFile.Name, err)
	}
	defer rc.Close()

	if _, err := io.Copy(tmp, rc); err != nil {
		return fmt.Errorf("stream to temp %s: %w", task.ZipFile.Name, err)
	}

	// Seek back to start before uploading
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("seek temp file: %w", err)
	}

	return client.UploadMultipart(ctx, task.R2Key, tmp, task.FileSize, partSize)
}

// UploadBytes is a convenience for small in-memory content (index.html patch, etc.).
func UploadBytes(ctx context.Context, client *r2.Client, r2Key string, data []byte) error {
	return client.PutObject(ctx, r2Key, data)
}

// readZipEntry reads the full content of a zip.File to memory.
func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, rc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
