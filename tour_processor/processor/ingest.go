package processor

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// ArtifactTourViewer is the default ingest artifact (existing tour ZIP path).
const ArtifactTourViewer = "tour_viewer"

// ArtifactTourAdmin is the per-tour admin package ZIP.
const ArtifactTourAdmin = "tour_admin"

// IngestSessionKey returns the on-disk session key for a tour + artifact.
// Viewer keeps the legacy tourId-only paths for backward compatibility.
func IngestSessionKey(tourID, artifactType string) string {
	if artifactType == "" || artifactType == ArtifactTourViewer {
		return tourID
	}
	return tourID + "__" + artifactType
}

// IngestSession is one chunked ZIP upload held on the Go temp disk.
type IngestSession struct {
	TourID         string `json:"tourId"`
	ArtifactType   string `json:"artifactType,omitempty"`
	SessionKey     string `json:"sessionKey,omitempty"` // on-disk key; defaults to TourID for viewer
	SessionID      string `json:"sessionId"`
	Filename       string `json:"filename"`
	FileSize       int64  `json:"fileSize"`
	ChunkSize      int64  `json:"chunkSize"`
	TotalChunks    int    `json:"totalChunks"`
	BackupVersion  string `json:"backupVersion"`
	SaveBackupZip  bool   `json:"saveBackupZip"`
	BackupKey      string `json:"backupKey"`
	BytesReceived  int64  `json:"bytesReceived"`
	Received       []bool `json:"received"`
	Assembled      bool   `json:"assembled"`
	ZipPath        string `json:"zipPath"`
	PublishDone    bool   `json:"publishDone"`
	BackupVerified bool   `json:"backupVerified"`
	// DirectWrite means chunks are written into ZipPath at byte offsets
	// (no part-* files, no concat assemble). Older sessions omit this
	// and fall back to part-file assemble on complete.
	DirectWrite bool `json:"directWrite,omitempty"`
}

func (sess *IngestSession) resolveSessionKey() string {
	if sess.SessionKey != "" {
		return sess.SessionKey
	}
	return IngestSessionKey(sess.TourID, sess.ArtifactType)
}

// IngestStore persists chunked uploads under the processor temp directory.
type IngestStore struct {
	tempDir  string
	mu       sync.Mutex            // guards tourLocks map only
	tourLocks map[string]*sync.Mutex // one mutex per tour for session metadata
}

func NewIngestStore(tempDir string) *IngestStore {
	return &IngestStore{
		tempDir:  tempDir,
		tourLocks: make(map[string]*sync.Mutex),
	}
}

func (s *IngestStore) sessionPath(sessionKey string) string {
	return filepath.Join(s.tempDir, "sessions", sessionKey+".json")
}

func (s *IngestStore) chunkDir(sessionKey string) string {
	return filepath.Join(s.tempDir, "ingest", sessionKey)
}

func (s *IngestStore) chunkPath(sessionKey string, n int) string {
	return filepath.Join(s.chunkDir(sessionKey), fmt.Sprintf("part-%05d", n))
}

func (s *IngestStore) publishedListPath(sessionKey string) string {
	return filepath.Join(s.chunkDir(sessionKey), "published.list")
}

func (s *IngestStore) zipFilePath(sessionKey string) string {
	return filepath.Join(s.tempDir, sessionKey+".zip")
}

// tourLock returns (and lazily creates) the per-tour metadata mutex.
func (s *IngestStore) tourLock(tourID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.tourLocks[tourID]
	if !ok {
		m = &sync.Mutex{}
		s.tourLocks[tourID] = m
	}
	return m
}

func (s *IngestStore) dropTourLock(tourID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tourLocks, tourID)
}

// Init creates (or replaces) an ingest session and pre-allocates the final ZIP.
func (s *IngestStore) Init(sess IngestSession) (*IngestSession, error) {
	if sess.TourID == "" || sess.TotalChunks <= 0 || sess.FileSize <= 0 || sess.ChunkSize <= 0 {
		return nil, fmt.Errorf("invalid ingest session")
	}
	if sess.ArtifactType == "" {
		sess.ArtifactType = ArtifactTourViewer
	}
	sess.SessionKey = IngestSessionKey(sess.TourID, sess.ArtifactType)
	key := sess.SessionKey

	tl := s.tourLock(key)
	tl.Lock()
	defer tl.Unlock()

	// Wipe any leftover artifacts from a prior attempt for this session key.
	os.RemoveAll(s.chunkDir(key))
	os.Remove(s.zipFilePath(key))

	if err := os.MkdirAll(s.chunkDir(key), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(s.sessionPath(key)), 0o755); err != nil {
		return nil, err
	}

	sess.Received = make([]bool, sess.TotalChunks)
	sess.BytesReceived = 0
	sess.Assembled = false
	sess.PublishDone = false
	sess.BackupVerified = false
	sess.DirectWrite = true
	sess.ZipPath = s.zipFilePath(key)

	// Pre-allocate the final ZIP so parallel WriteAt calls land at fixed offsets.
	f, err := os.OpenFile(sess.ZipPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, fmt.Errorf("create zip: %w", err)
	}
	if err := f.Truncate(sess.FileSize); err != nil {
		f.Close()
		os.Remove(sess.ZipPath)
		return nil, fmt.Errorf("preallocate zip: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(sess.ZipPath)
		return nil, err
	}

	if err := s.saveLocked(&sess); err != nil {
		os.Remove(sess.ZipPath)
		return nil, err
	}
	return &sess, nil
}

// WriteChunk stores part n (1-based). For DirectWrite sessions the bytes go
// straight into ZipPath at (n-1)*ChunkSize. I/O runs outside the tour lock so
// multiple chunks can land in parallel. Legacy part-file sessions still work.
func (s *IngestStore) WriteChunk(sessionKey string, n int, r io.Reader) (*IngestSession, error) {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	sess, err := s.loadLocked(sessionKey)
	if err != nil {
		tl.Unlock()
		return nil, err
	}
	if n < 1 || n > sess.TotalChunks {
		tl.Unlock()
		return nil, fmt.Errorf("chunk %d out of range 1..%d", n, sess.TotalChunks)
	}
	if sess.Assembled {
		tl.Unlock()
		return nil, fmt.Errorf("session already finalized")
	}

	direct := sess.DirectWrite
	zipPath := sess.ZipPath
	chunkSize := sess.ChunkSize
	fileSize := sess.FileSize
	partPath := s.chunkPath(sessionKey, n)
	// Snapshot for I/O; release lock before slow disk/network copy.
	tl.Unlock()

	var written int64
	if direct {
		written, err = writeChunkAt(zipPath, n, chunkSize, fileSize, r)
	} else {
		written, err = writeChunkPart(partPath, r)
	}
	if err != nil {
		return nil, err
	}

	tl.Lock()
	defer tl.Unlock()

	// Reload — other chunks may have updated Received[] while we wrote.
	sess, err = s.loadLocked(sessionKey)
	if err != nil {
		return nil, err
	}
	if n < 1 || n > sess.TotalChunks {
		return nil, fmt.Errorf("chunk %d out of range 1..%d", n, sess.TotalChunks)
	}

	already := sess.Received[n-1]
	sess.Received[n-1] = true
	if !already {
		sess.BytesReceived += written
	} else {
		sess.BytesReceived = s.sumReceivedBytesLocked(sess)
	}
	if err := s.saveLocked(sess); err != nil {
		return nil, err
	}
	return sess, nil
}

func writeChunkAt(zipPath string, n int, chunkSize, fileSize int64, r io.Reader) (int64, error) {
	offset := int64(n-1) * chunkSize
	if offset >= fileSize {
		return 0, fmt.Errorf("chunk %d offset %d beyond file size %d", n, offset, fileSize)
	}
	maxLen := chunkSize
	if offset+maxLen > fileSize {
		maxLen = fileSize - offset
	}

	f, err := os.OpenFile(zipPath, os.O_RDWR, 0o644)
	if err != nil {
		return 0, fmt.Errorf("open zip for chunk %d: %w", n, err)
	}
	defer f.Close()

	limited := io.LimitReader(r, maxLen)
	written, err := copyAt(f, offset, limited)
	if err != nil {
		return written, fmt.Errorf("write chunk %d: %w", n, err)
	}
	if written != maxLen {
		return written, fmt.Errorf("chunk %d short write: got %d want %d", n, written, maxLen)
	}
	// Drain any trailing bytes the client may have sent (should be none).
	_, _ = io.Copy(io.Discard, r)
	return written, nil
}

func copyAt(f *os.File, offset int64, r io.Reader) (int64, error) {
	buf := make([]byte, 256*1024)
	var total int64
	pos := offset
	for {
		nr, readErr := r.Read(buf)
		if nr > 0 {
			nw, writeErr := f.WriteAt(buf[:nr], pos)
			total += int64(nw)
			pos += int64(nw)
			if writeErr != nil {
				return total, writeErr
			}
			if nw != nr {
				return total, io.ErrShortWrite
			}
		}
		if readErr == io.EOF {
			return total, nil
		}
		if readErr != nil {
			return total, readErr
		}
	}
}

func writeChunkPart(path string, r io.Reader) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	written, copyErr := io.Copy(f, r)
	closeErr := f.Close()
	if copyErr != nil {
		return written, copyErr
	}
	if closeErr != nil {
		return written, closeErr
	}
	return written, nil
}

func (s *IngestStore) hasLegacyPartsLocked(sess *IngestSession) bool {
	if sess.DirectWrite {
		return false
	}
	// Probe first part — if present, this is an old part-file session.
	_, err := os.Stat(s.chunkPath(sess.resolveSessionKey(), 1))
	return err == nil
}

func (s *IngestStore) sumReceivedBytesLocked(sess *IngestSession) int64 {
	if sess.DirectWrite {
		var total int64
		for i := 0; i < sess.TotalChunks; i++ {
			if !sess.Received[i] {
				continue
			}
			start := int64(i) * sess.ChunkSize
			end := start + sess.ChunkSize
			if end > sess.FileSize {
				end = sess.FileSize
			}
			total += end - start
		}
		return total
	}
	var total int64
	for i := 1; i <= sess.TotalChunks; i++ {
		if !sess.Received[i-1] {
			continue
		}
		fi, err := os.Stat(s.chunkPath(sess.resolveSessionKey(), i))
		if err != nil {
			continue
		}
		total += fi.Size()
	}
	return total
}

// Status returns the session and the 1-based chunk numbers still missing.
func (s *IngestStore) Status(sessionKey string) (*IngestSession, []int, error) {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	defer tl.Unlock()
	sess, err := s.loadLocked(sessionKey)
	if err != nil {
		return nil, nil, err
	}
	var missing []int
	for i, ok := range sess.Received {
		if !ok {
			missing = append(missing, i+1)
		}
	}
	return sess, missing, nil
}

// Assemble finalizes the ZIP. DirectWrite sessions only verify size (fast).
// Legacy part-file sessions still concatenate into ZipPath.
func (s *IngestStore) Assemble(sessionKey string) (*IngestSession, error) {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	defer tl.Unlock()

	sess, err := s.loadLocked(sessionKey)
	if err != nil {
		return nil, err
	}
	for i, ok := range sess.Received {
		if !ok {
			return nil, fmt.Errorf("chunk %d missing", i+1)
		}
	}

	if sess.Assembled {
		return sess, nil
	}

	legacy := !sess.DirectWrite && s.hasLegacyPartsLocked(sess)
	if legacy {
		return s.assembleLegacyLocked(sess)
	}
	return s.finalizeDirectLocked(sess)
}

func (s *IngestStore) finalizeDirectLocked(sess *IngestSession) (*IngestSession, error) {
	fi, err := os.Stat(sess.ZipPath)
	if err != nil {
		return nil, fmt.Errorf("stat zip: %w", err)
	}
	if fi.Size() != sess.FileSize {
		return nil, fmt.Errorf("assembled ZIP is %d bytes, expected %d", fi.Size(), sess.FileSize)
	}
	// Light integrity check: ZIP local-file header magic.
	if err := checkZipMagic(sess.ZipPath); err != nil {
		return nil, err
	}
	sess.Assembled = true
	sess.BytesReceived = sess.FileSize
	sess.DirectWrite = true
	if err := s.saveLocked(sess); err != nil {
		return nil, err
	}
	return sess, nil
}

func checkZipMagic(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var hdr [4]byte
	n, err := io.ReadFull(f, hdr[:])
	if err != nil || n < 4 {
		return fmt.Errorf("zip header unreadable: %w", err)
	}
	// PK\x03\x04 (local file) or PK\x05\x06 (empty archive EOCD)
	if hdr[0] != 'P' || hdr[1] != 'K' {
		return fmt.Errorf("not a ZIP file (bad magic)")
	}
	return nil
}

func (s *IngestStore) assembleLegacyLocked(sess *IngestSession) (*IngestSession, error) {
	key := sess.resolveSessionKey()
	dest, err := os.Create(sess.ZipPath)
	if err != nil {
		return nil, err
	}
	var total int64
	for i := 1; i <= sess.TotalChunks; i++ {
		part, err := os.Open(s.chunkPath(key, i))
		if err != nil {
			dest.Close()
			return nil, err
		}
		n, err := io.Copy(dest, part)
		part.Close()
		if err != nil {
			dest.Close()
			return nil, err
		}
		total += n
	}
	if err := dest.Close(); err != nil {
		return nil, err
	}
	if total != sess.FileSize {
		os.Remove(sess.ZipPath)
		return nil, fmt.Errorf("assembled ZIP is %d bytes, expected %d", total, sess.FileSize)
	}
	// Drop part files after successful concat to free disk.
	for i := 1; i <= sess.TotalChunks; i++ {
		os.Remove(s.chunkPath(key, i))
	}
	sess.Assembled = true
	sess.BytesReceived = total
	if err := s.saveLocked(sess); err != nil {
		return nil, err
	}
	return sess, nil
}

// Abort removes chunks, the assembled ZIP, and the session file.
func (s *IngestStore) Abort(sessionKey string) error {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	sess, err := s.loadLocked(sessionKey)
	zipPath := ""
	if err == nil && sess != nil {
		zipPath = sess.ZipPath
	}
	os.RemoveAll(s.chunkDir(sessionKey))
	if zipPath != "" {
		os.Remove(zipPath)
	} else {
		os.Remove(s.zipFilePath(sessionKey))
	}
	os.Remove(s.sessionPath(sessionKey))
	tl.Unlock()
	s.dropTourLock(sessionKey)
	return nil
}

// Load returns a session if one exists on disk.
func (s *IngestStore) Load(sessionKey string) (*IngestSession, error) {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	defer tl.Unlock()
	return s.loadLocked(sessionKey)
}

// Update persists caller mutations (publish/backup flags, backup key).
func (s *IngestStore) Update(sess *IngestSession) error {
	key := sess.resolveSessionKey()
	tl := s.tourLock(key)
	tl.Lock()
	defer tl.Unlock()
	return s.saveLocked(sess)
}

// LoadPublished returns relative paths already uploaded for this session.
func (s *IngestStore) LoadPublished(sessionKey string) (map[string]struct{}, error) {
	data, err := os.ReadFile(s.publishedListPath(sessionKey))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]struct{}{}, nil
		}
		return nil, err
	}
	out := map[string]struct{}{}
	start := 0
	for i := 0; i <= len(data); i++ {
		if i == len(data) || data[i] == '\n' {
			line := string(data[start:i])
			if line != "" {
				out[line] = struct{}{}
			}
			start = i + 1
		}
	}
	return out, nil
}

// MarkPublished appends one relative path to the local checkpoint.
func (s *IngestStore) MarkPublished(sessionKey, rel string) error {
	if err := os.MkdirAll(s.chunkDir(sessionKey), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(s.publishedListPath(sessionKey), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintln(f, rel)
	return err
}

// CleanupSessionFiles removes ingest artifacts after a verified backup.
// The caller must have confirmed the backup object first.
func (s *IngestStore) CleanupSessionFiles(sessionKey string) error {
	tl := s.tourLock(sessionKey)
	tl.Lock()
	sess, err := s.loadLocked(sessionKey)
	if err == nil && sess != nil && sess.ZipPath != "" {
		os.Remove(sess.ZipPath)
	}
	os.Remove(s.zipFilePath(sessionKey))
	os.RemoveAll(s.chunkDir(sessionKey))
	// Multipart staging files created for large ZIP entries.
	matches, _ := filepath.Glob(filepath.Join(s.tempDir, sanitizeTempPrefix(sessionKey)+"-r2upload-*.tmp"))
	for _, m := range matches {
		os.Remove(m)
	}
	os.Remove(s.sessionPath(sessionKey))
	tl.Unlock()
	s.dropTourLock(sessionKey)
	return nil
}

func (s *IngestStore) loadLocked(sessionKey string) (*IngestSession, error) {
	data, err := os.ReadFile(s.sessionPath(sessionKey))
	if err != nil {
		return nil, err
	}
	var sess IngestSession
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, err
	}
	if sess.SessionKey == "" {
		sess.SessionKey = sessionKey
	}
	if len(sess.Received) != sess.TotalChunks && sess.TotalChunks > 0 {
		resized := make([]bool, sess.TotalChunks)
		copy(resized, sess.Received)
		sess.Received = resized
	}
	return &sess, nil
}

func (s *IngestStore) saveLocked(sess *IngestSession) error {
	key := sess.resolveSessionKey()
	if err := os.MkdirAll(filepath.Dir(s.sessionPath(key)), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.sessionPath(key), data, 0o644)
}

// ReceivedNumbers returns 1-based chunk indexes that are present.
func ReceivedNumbers(sess *IngestSession) []int {
	var out []int
	for i, ok := range sess.Received {
		if ok {
			out = append(out, i+1)
		}
	}
	sort.Ints(out)
	return out
}
