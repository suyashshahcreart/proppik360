package processor

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"tour-processor/r2"
)

// ManifestFile is one published object under tours/{slug}/.
type ManifestFile struct {
	Size      int64  `json:"size"`
	ETag      string `json:"etag"`
	UpdatedAt string `json:"updated_at"`
}

// Manifest is the merge checkpoint stored at tours/{slug}/.manifest.json.
// Files not present in a later ZIP are left untouched (Policy 2).
type Manifest struct {
	TourSlug      string                  `json:"tour_slug"`
	UpdatedAt     string                  `json:"updated_at"`
	UploadVersion string                  `json:"upload_version"`
	Files         map[string]ManifestFile `json:"files"`
}

func manifestKey(tourID string) string {
	return tourID + "/.manifest.json"
}

func publishPrefix(tourID string) string {
	return tourID + "/"
}

// LoadManifest reads the current manifest. A missing object is an empty manifest.
func LoadManifest(ctx context.Context, client *r2.Client, tourID string) (*Manifest, error) {
	data, exists, err := client.GetObject(ctx, manifestKey(tourID))
	if err != nil {
		return nil, err
	}
	m := &Manifest{
		TourSlug: tourID,
		Files:    map[string]ManifestFile{},
	}
	if !exists || len(data) == 0 {
		return m, nil
	}
	if err := json.Unmarshal(data, m); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	if m.Files == nil {
		m.Files = map[string]ManifestFile{}
	}
	return m, nil
}

// SaveManifest writes the merged manifest last so a crash mid-publish can resume
// from the local published.list plus this snapshot.
func SaveManifest(ctx context.Context, client *r2.Client, tourID string, m *Manifest) error {
	m.TourSlug = tourID
	m.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if m.Files == nil {
		m.Files = map[string]ManifestFile{}
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return client.PutObject(ctx, manifestKey(tourID), data)
}

// ShouldSkipPublish reports whether this ZIP entry is already on R2 at the same size.
// Used when resuming a publish that died before the manifest flush.
func ShouldSkipPublish(ctx context.Context, client *r2.Client, key string, size int64, already map[string]struct{}, rel string) bool {
	if _, ok := already[rel]; ok {
		return true
	}
	got, _, exists, err := client.HeadObject(ctx, key)
	if err != nil || !exists {
		return false
	}
	return got == size
}

func relativeFromKey(prefix, key string) string {
	return strings.TrimPrefix(key, prefix)
}
