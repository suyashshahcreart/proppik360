package processor

import (
	"context"
	"fmt"
	"log"
	"os"

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
