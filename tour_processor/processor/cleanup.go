package processor

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"tour-processor/r2"
)

// CleanupAfterBackup deletes Go temp files only after the backup object and
// at least one published file have been confirmed.
func CleanupAfterBackup(
	ctx context.Context,
	client *r2.Client,
	store *IngestStore,
	tourID, backupKey, zipPath, entryKey string,
	verifyAttempts int,
) error {
	if backupKey == "" {
		return fmt.Errorf("refusing cleanup: no backup key")
	}
	if zipPath != "" {
		if _, err := os.Stat(zipPath); err == nil {
			if err := VerifyBackup(ctx, client, backupKey, zipPath, verifyAttempts); err != nil {
				return fmt.Errorf("cleanup blocked, backup not verified: %w", err)
			}
		} else {
			size, _, exists, err := client.HeadObject(ctx, backupKey)
			if err != nil || !exists || size <= 0 {
				return fmt.Errorf("cleanup blocked, backup missing and local ZIP gone")
			}
		}
	} else {
		_, _, exists, err := client.HeadObject(ctx, backupKey)
		if err != nil || !exists {
			return fmt.Errorf("cleanup blocked, backup HEAD failed")
		}
	}

	if entryKey != "" {
		_, _, exists, err := client.HeadObject(ctx, entryKey)
		if err != nil || !exists {
			return fmt.Errorf("cleanup blocked, %s not on R2", entryKey)
		}
	}

	// Third confirmation: backup still present immediately before delete.
	_, _, exists, err := client.HeadObject(ctx, backupKey)
	if err != nil || !exists {
		return fmt.Errorf("cleanup blocked, final backup HEAD failed")
	}

	if err := store.CleanupSessionFiles(tourID); err != nil {
		return err
	}
	log.Printf("[job:%s] Go temp cleaned (backup=%s)", tourID, backupKey)
	return nil
}

// CleanupWithoutBackup removes Go temp files after publish when no ZIP backup was requested.
func CleanupWithoutBackup(
	ctx context.Context,
	client *r2.Client,
	store *IngestStore,
	tourID, zipPath, entryKey string,
) error {
	if entryKey != "" {
		_, _, exists, err := client.HeadObject(ctx, entryKey)
		if err != nil || !exists {
			return fmt.Errorf("cleanup blocked, %s not on R2", entryKey)
		}
	}

	if zipPath != "" {
		if _, err := os.Stat(zipPath); err != nil {
			log.Printf("[job:%s] local ZIP already removed before cleanup", tourID)
		}
	}

	if err := store.CleanupSessionFiles(tourID); err != nil {
		return err
	}
	log.Printf("[job:%s] Go temp cleaned (no backup ZIP)", tourID)
	return nil
}

// CleanupWithoutBackupVPS removes Go temp files after VPS publish (no R2 HEAD).
func CleanupWithoutBackupVPS(store *IngestStore, sessionKey, zipPath, entryPath string) error {
	if entryPath != "" {
		st, err := os.Stat(entryPath)
		if err != nil || st.IsDir() {
			return fmt.Errorf("cleanup blocked, %s not on disk", entryPath)
		}
	}
	if zipPath != "" {
		if _, err := os.Stat(zipPath); err != nil {
			log.Printf("[job:%s] local ZIP already removed before VPS cleanup", sessionKey)
		}
	}
	if err := store.CleanupSessionFiles(sessionKey); err != nil {
		return err
	}
	log.Printf("[job:%s] Go temp cleaned (VPS, no backup ZIP)", sessionKey)
	return nil
}

// CleanupAfterBackupVPS verifies local backup + index before temp cleanup.
func CleanupAfterBackupVPS(
	store *IngestStore,
	sessionKey string,
	sess *IngestSession,
	publishRoot, entryPath string,
	verifyAttempts int,
) error {
	if sess.BackupKey == "" {
		return fmt.Errorf("refusing cleanup: no backup key")
	}
	dest, err := resolveAdminVpsDest(publishRoot, sess.TourID)
	if err != nil {
		return err
	}
	parts := strings.Split(sess.BackupKey, "/")
	backupFile := parts[len(parts)-1]
	backupPath := filepath.Join(dest, "backup_zip", backupFile)
	st, err := os.Stat(backupPath)
	if err != nil || st.Size() <= 0 {
		return fmt.Errorf("cleanup blocked, backup missing at %s", backupPath)
	}
	if zipPath := sess.ZipPath; zipPath != "" {
		if _, err := os.Stat(zipPath); err == nil {
			if err := verifyLocalBackupFile(backupPath, st.Size(), verifyAttempts); err != nil {
				return fmt.Errorf("cleanup blocked, backup not verified: %w", err)
			}
		}
	}
	if entryPath != "" {
		if st, err := os.Stat(entryPath); err != nil || st.IsDir() {
			return fmt.Errorf("cleanup blocked, %s not on disk", entryPath)
		}
	}
	if err := store.CleanupSessionFiles(sessionKey); err != nil {
		return err
	}
	log.Printf("[job:%s] Go temp cleaned (VPS backup=%s)", sessionKey, sess.BackupKey)
	return nil
}
