// Package api provides an HTTP client for calling the Worker API.
// All calls use the X-Processor-Secret header for authentication.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is an authenticated HTTP client for the Worker API.
type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

// NewClient creates a Worker API client.
func NewClient(baseURL, secret string) *Client {
	return &Client{
		baseURL: baseURL,
		secret:  secret,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// TourResponse is the tour data returned by the Worker's processor endpoint.
type TourResponse struct {
	Tour struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		OwnerID          string `json:"owner_id"`
		R2Key            string `json:"r2_key"`
		FileSize         int64  `json:"file_size"`
		OriginalFilename string `json:"original_filename"`
		Status           string `json:"status"`
	} `json:"tour"`
	DownloadURL string `json:"downloadUrl"`
}

// GetTour fetches tour details and a presigned download URL for the ZIP.
func (c *Client) GetTour(tourID string) (*TourResponse, error) {
	url := fmt.Sprintf("%s/api/processor/tours/%s", c.baseURL, tourID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("X-Processor-Secret", c.secret)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET tour %s: HTTP %d: %s", tourID, resp.StatusCode, body)
	}

	var envelope struct {
		Success bool         `json:"success"`
		Data    TourResponse `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if !envelope.Success {
		return nil, fmt.Errorf("worker returned success=false for tour %s", tourID)
	}

	return &envelope.Data, nil
}

// Complete notifies the Worker that processing succeeded.
// viewerURL is the public URL to the extracted index.html.
func (c *Client) Complete(tourID, viewerURL, layout string) error {
	body := map[string]string{"viewerUrl": viewerURL}
	if layout != "" {
		body["layout"] = layout
	}
	return c.postJSON(
		fmt.Sprintf("%s/api/processor/tours/%s/complete", c.baseURL, tourID),
		body,
	)
}

// BackupComplete records the verified backup object key.
func (c *Client) BackupComplete(tourID, backupKey, version string) error {
	return c.postJSON(
		fmt.Sprintf("%s/api/processor/tours/%s/backup-complete", c.baseURL, tourID),
		map[string]string{"backupKey": backupKey, "version": version},
	)
}

// MarkCompleted tells the Worker that backup and Go cleanup both finished.
func (c *Client) MarkCompleted(tourID string) error {
	return c.postJSON(
		fmt.Sprintf("%s/api/processor/tours/%s/completed", c.baseURL, tourID),
		map[string]any{},
	)
}

// Fail notifies the Worker that processing failed with an error message.
func (c *Client) Fail(tourID, errMsg string) error {
	return c.postJSON(
		fmt.Sprintf("%s/api/processor/tours/%s/fail", c.baseURL, tourID),
		map[string]string{"error": errMsg},
	)
}

// Progress sends a live progress update to the Worker.
// Called ~every 2s by the ticker goroutine in RunWorkerPool.
// stage is optional (empty string leaves the existing stage unchanged on the Worker
// unless the Worker treats empty as omit — we only send it when non-empty).
// Errors are logged but do NOT abort processing — progress updates are best-effort.
func (c *Client) Progress(tourID string, currentFiles, totalFiles int, currentBytes, totalBytes int64, stage string) error {
	body := map[string]any{
		"currentFiles": currentFiles,
		"totalFiles":   totalFiles,
		"currentBytes": currentBytes,
		"totalBytes":   totalBytes,
	}
	if stage != "" {
		body["stage"] = stage
	}
	return c.postJSON(
		fmt.Sprintf("%s/api/processor/tours/%s/progress", c.baseURL, tourID),
		body,
	)
}

// SetStage reports a pipeline stage without overwriting meaningful file counters
// when totals are still unknown (sends zeros + stage).
func (c *Client) SetStage(tourID, stage string) error {
	return c.Progress(tourID, 0, 0, 0, 0, stage)
}

// PendingTour is a compact pending-job row from GET /api/processor/pending.
type PendingTour struct {
	ID                   string  `json:"id"`
	Status               string  `json:"status"`
	R2Key                *string `json:"r2_key"`
	UpdatedAt            string  `json:"updated_at"`
	ProcessingStartedAt  *string `json:"processing_started_at"`
	ProgressCurrentFiles *int    `json:"progress_current_files"`
}

// ListPending fetches tour IDs that still need processing (uploaded/processing).
func (c *Client) ListPending() ([]PendingTour, error) {
	url := fmt.Sprintf("%s/api/processor/pending", c.baseURL)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("X-Processor-Secret", c.secret)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET pending: HTTP %d: %s", resp.StatusCode, body)
	}

	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			TourIDs []string      `json:"tourIds"`
			Tours   []PendingTour `json:"tours"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode pending: %w", err)
	}
	if !envelope.Success {
		return nil, fmt.Errorf("worker returned success=false for pending")
	}
	if len(envelope.Data.Tours) > 0 {
		return envelope.Data.Tours, nil
	}

	out := make([]PendingTour, 0, len(envelope.Data.TourIDs))
	for _, id := range envelope.Data.TourIDs {
		out = append(out, PendingTour{ID: id, Status: "processing"})
	}
	return out, nil
}

// Reconcile asks the Worker to heal stuck uploads and re-dispatch stale jobs.
func (c *Client) Reconcile() error {
	return c.postJSON(fmt.Sprintf("%s/api/processor/reconcile", c.baseURL), map[string]any{})
}

// ── Artifact (tour_admin) callbacks ─────────────────────────────

func (c *Client) artifactURL(tourID, artifactType, suffix string) string {
	return fmt.Sprintf("%s/api/processor/artifacts/%s/%s/%s", c.baseURL, tourID, artifactType, suffix)
}

// ArtifactComplete notifies Worker that admin package publish succeeded.
func (c *Client) ArtifactComplete(tourID, artifactType, publishURL, layout string, saveBackupZip bool) error {
	return c.postJSON(c.artifactURL(tourID, artifactType, "complete"), map[string]any{
		"publishUrl":     publishURL,
		"layout":         layout,
		"saveBackupZip":  saveBackupZip,
	})
}

// ArtifactBackupComplete records the verified admin backup key.
func (c *Client) ArtifactBackupComplete(tourID, artifactType, backupKey, version string) error {
	return c.postJSON(c.artifactURL(tourID, artifactType, "backup-complete"), map[string]string{
		"backupKey": backupKey,
		"version":   version,
	})
}

// ArtifactMarkCompleted tells Worker that admin backup/cleanup finished.
func (c *Client) ArtifactMarkCompleted(tourID, artifactType string) error {
	return c.postJSON(c.artifactURL(tourID, artifactType, "completed"), map[string]any{})
}

// ArtifactFail notifies Worker that admin package processing failed.
func (c *Client) ArtifactFail(tourID, artifactType, errMsg string) error {
	return c.postJSON(c.artifactURL(tourID, artifactType, "fail"), map[string]string{"error": errMsg})
}

// ArtifactProgress sends live progress for an artifact job.
func (c *Client) ArtifactProgress(tourID, artifactType string, currentFiles, totalFiles int, currentBytes, totalBytes int64, stage string) error {
	body := map[string]any{
		"currentFiles": currentFiles,
		"totalFiles":   totalFiles,
		"currentBytes": currentBytes,
		"totalBytes":   totalBytes,
	}
	if stage != "" {
		body["stage"] = stage
	}
	return c.postJSON(c.artifactURL(tourID, artifactType, "progress"), body)
}

// ArtifactSetStage reports a pipeline stage for an artifact.
func (c *Client) ArtifactSetStage(tourID, artifactType, stage string) error {
	return c.ArtifactProgress(tourID, artifactType, 0, 0, 0, 0, stage)
}

func (c *Client) postJSON(url string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Processor-Secret", c.secret)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("POST %s: HTTP %d: %s", url, resp.StatusCode, b)
	}

	return nil
}
