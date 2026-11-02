package processor

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var tourIDVPSPattern = regexp.MustCompile(`^\d{6}$`)

const defaultAdminPublicPathPrefix = "/admin"

func normalizeAdminPublicPathPrefix(prefix string) string {
	p := strings.TrimSpace(prefix)
	if p == "" {
		p = defaultAdminPublicPathPrefix
	}
	p = strings.TrimSuffix(p, "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func buildAdminVpsPublishURL(host, pathPrefix, tourID string) string {
	h := strings.TrimSpace(host)
	h = strings.TrimPrefix(strings.TrimPrefix(h, "https://"), "http://")
	h = strings.TrimSuffix(h, "/")
	prefix := normalizeAdminPublicPathPrefix(pathPrefix)
	path := fmt.Sprintf("%s/%s/index.html", prefix, tourID)
	path = strings.ReplaceAll(path, "//", "/")
	return fmt.Sprintf("https://%s%s", h, path)
}

func resolveAdminVpsDest(root, tourID string) (string, error) {
	if !tourIDVPSPattern.MatchString(tourID) {
		return "", fmt.Errorf("invalid tour id for VPS publish: %q", tourID)
	}
	root = strings.TrimSpace(root)
	if root == "" {
		return "", fmt.Errorf("TOUR_ADMIN_PUBLISH_ROOT is empty")
	}
	dest := filepath.Join(root, tourID)
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	cleanDest, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	rootPrefix := cleanRoot + string(os.PathSeparator)
	if cleanDest != cleanRoot && !strings.HasPrefix(cleanDest, rootPrefix) {
		return "", fmt.Errorf("refusing unsafe publish path")
	}
	return cleanDest, nil
}

func clearVpsDestExceptBackup(dest string) error {
	entries, err := os.ReadDir(dest)
	if err != nil {
		if os.IsNotExist(err) {
			return os.MkdirAll(dest, 0o755)
		}
		return err
	}
	for _, e := range entries {
		if e.Name() == "backup_zip" {
			continue
		}
		p := filepath.Join(dest, e.Name())
		if err := os.RemoveAll(p); err != nil {
			return fmt.Errorf("clear %s: %w", p, err)
		}
	}
	return nil
}

func safeExtractPath(dest, rel string) (string, error) {
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("zip path escapes destination: %q", rel)
	}
	target := filepath.Join(dest, rel)
	cleanDest, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	cleanTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	destPrefix := cleanDest + string(os.PathSeparator)
	if cleanTarget != cleanDest && !strings.HasPrefix(cleanTarget, destPrefix) {
		return "", fmt.Errorf("zip path escapes destination: %q", rel)
	}
	return cleanTarget, nil
}

func zipEntryRelPath(name, stripPrefix string) string {
	n := filepath.ToSlash(name)
	if stripPrefix != "" && strings.HasPrefix(n, stripPrefix) {
		n = strings.TrimPrefix(n, stripPrefix)
	}
	n = strings.TrimPrefix(n, "/")
	return n
}

func extractZipToVpsDest(zipPath, dest, stripPrefix string) (int, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return 0, err
	}
	defer zr.Close()

	written := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rel := zipEntryRelPath(f.Name, stripPrefix)
		if rel == "" {
			continue
		}
		target, err := safeExtractPath(dest, rel)
		if err != nil {
			return written, err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return written, err
		}
		rc, err := f.Open()
		if err != nil {
			return written, err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			rc.Close()
			return written, err
		}
		_, copyErr := io.Copy(out, rc)
		closeErr := rc.Close()
		out.Close()
		if copyErr != nil {
			return written, copyErr
		}
		if closeErr != nil {
			return written, closeErr
		}
		written++
	}
	return written, nil
}

func runAdminPublishVPS(ctx context.Context, cfg AdminPipelineConfig, tourID, sessionKey string, sess *IngestSession) error {
	zipPath := sess.ZipPath
	log.Printf("[admin-job:%s] VPS publish opening ZIP", tourID)
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "extracting")

	dest, err := resolveAdminVpsDest(cfg.AdminPublishRoot, tourID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return fmt.Errorf("mkdir publish dest: %w", err)
	}
	if err := clearVpsDestExceptBackup(dest); err != nil {
		return err
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open ZIP: %w", err)
	}
	_, files := AnalyzeZIPReader(zr)
	zr.Close()
	if len(files) == 0 {
		return fmt.Errorf("ZIP contains no files")
	}
	if !adminZipHasIndex(files) {
		return fmt.Errorf("admin ZIP must contain index.html at root or under a single top-level folder")
	}
	stripPrefix := StripTopLevelFolder(files)
	total := 0
	for _, f := range files {
		if !f.FileInfo().IsDir() {
			total++
		}
	}
	_ = cfg.WorkerClient.ArtifactProgress(tourID, ArtifactTourAdmin, 0, total, 0, 0, "publishing")

	written, err := extractZipToVpsDest(zipPath, dest, stripPrefix)
	if err != nil {
		return fmt.Errorf("extract to VPS: %w", err)
	}
	_ = cfg.WorkerClient.ArtifactProgress(tourID, ArtifactTourAdmin, written, total, 0, 0, "publishing")

	indexPath := filepath.Join(dest, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return fmt.Errorf("index.html missing after extract: %w", err)
	}

	publishURL := buildAdminVpsPublishURL(cfg.AdminPublicHost, cfg.AdminPublicPathPrefix, tourID)
	if publishURL == "" {
		return fmt.Errorf("could not build admin VPS publish URL")
	}
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "finalizing")
	if err := cfg.WorkerClient.ArtifactComplete(tourID, ArtifactTourAdmin, publishURL, "flat", sess.SaveBackupZip); err != nil {
		return fmt.Errorf("notify ready: %w", err)
	}
	sess.PublishDone = true
	if err := cfg.Ingest.Update(sess); err != nil {
		log.Printf("[admin-job:%s] session update failed (non-fatal): %v", tourID, err)
	}
	log.Printf("[admin-job:%s] VPS published to %s (%d files)", tourID, dest, written)
	return nil
}

func runAdminBackupVPS(ctx context.Context, cfg AdminPipelineConfig, tourID string, sess *IngestSession, attempts int) error {
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "backing_up")
	dest, err := resolveAdminVpsDest(cfg.AdminPublishRoot, tourID)
	if err != nil {
		return err
	}
	backupDir := filepath.Join(dest, "backup_zip")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return err
	}

	version := sess.BackupVersion
	if version == "" {
		version = "first"
	}
	name := SanitizeZipBase(sess.Filename)
	objectName := BackupZipName(name, version, time.Now())
	key := BackupKey(tourID, objectName)
	target := filepath.Join(backupDir, objectName)

	src, err := os.Open(sess.ZipPath)
	if err != nil {
		return fmt.Errorf("open zip for backup: %w", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	dst, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return fmt.Errorf("backup copy: %w", err)
	}
	if err := dst.Close(); err != nil {
		return err
	}
	if err := verifyLocalBackupFile(target, info.Size(), attempts); err != nil {
		return err
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

func verifyLocalBackupFile(path string, expectedSize int64, attempts int) error {
	if attempts <= 0 {
		attempts = 3
	}
	var lastErr error
	for i := 0; i < attempts; i++ {
		st, err := os.Stat(path)
		if err == nil && st.Size() == expectedSize && st.Size() > 0 {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("size mismatch: got %d want %d", st.Size(), expectedSize)
		}
		time.Sleep(200 * time.Millisecond)
	}
	if lastErr != nil {
		return fmt.Errorf("backup verify failed: %w", lastErr)
	}
	return fmt.Errorf("backup verify failed")
}

func finishAdminCleanupVPS(ctx context.Context, cfg AdminPipelineConfig, tourID, sessionKey string, sess *IngestSession, attempts int) error {
	_ = ctx
	_ = cfg.WorkerClient.ArtifactSetStage(tourID, ArtifactTourAdmin, "cleanup")
	dest, err := resolveAdminVpsDest(cfg.AdminPublishRoot, tourID)
	if err != nil {
		return err
	}
	entryPath := filepath.Join(dest, "index.html")
	var cleanupErr error
	if sess.SaveBackupZip {
		cleanupErr = CleanupAfterBackupVPS(cfg.Ingest, sessionKey, sess, cfg.AdminPublishRoot, entryPath, attempts)
	} else {
		cleanupErr = CleanupWithoutBackupVPS(cfg.Ingest, sessionKey, sess.ZipPath, entryPath)
	}
	if cleanupErr != nil {
		return cleanupErr
	}
	if err := cfg.WorkerClient.ArtifactMarkCompleted(tourID, ArtifactTourAdmin); err != nil {
		return fmt.Errorf("notify completed: %w", err)
	}
	return nil
}
