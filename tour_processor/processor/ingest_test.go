package processor

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func testZipPayload(size int) []byte {
	// Minimal ZIP local-file header magic so checkZipMagic passes.
	buf := make([]byte, size)
	copy(buf, []byte{'P', 'K', 0x03, 0x04})
	for i := 4; i < size; i++ {
		buf[i] = byte(i % 251)
	}
	return buf
}

func newTestStore(t *testing.T) *IngestStore {
	t.Helper()
	dir := t.TempDir()
	return NewIngestStore(dir)
}

func initSession(t *testing.T, s *IngestStore, tourID string, data []byte, chunkSize int64) *IngestSession {
	t.Helper()
	total := len(data)
	chunks := int((int64(total) + chunkSize - 1) / chunkSize)
	sess, err := s.Init(IngestSession{
		TourID:      tourID,
		SessionID:   "sess-1",
		Filename:    "tour.zip",
		FileSize:    int64(total),
		ChunkSize:   chunkSize,
		TotalChunks: chunks,
	})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	if !sess.DirectWrite {
		t.Fatal("expected DirectWrite=true")
	}
	fi, err := os.Stat(sess.ZipPath)
	if err != nil {
		t.Fatalf("preallocated zip missing: %v", err)
	}
	if fi.Size() != int64(total) {
		t.Fatalf("preallocate size=%d want=%d", fi.Size(), total)
	}
	return sess
}

func TestIngestDirectWriteAssemble(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(1000)
	const chunkSize = 256
	sess := initSession(t, s, "tour-a", data, chunkSize)

	for n := 1; n <= sess.TotalChunks; n++ {
		start := int64(n-1) * chunkSize
		end := start + chunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		_, err := s.WriteChunk(sess.TourID, n, bytes.NewReader(data[start:end]))
		if err != nil {
			t.Fatalf("WriteChunk %d: %v", n, err)
		}
	}

	out, err := s.Assemble(sess.TourID)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	if !out.Assembled {
		t.Fatal("expected Assembled=true")
	}

	got, err := os.ReadFile(out.ZipPath)
	if err != nil {
		t.Fatalf("read zip: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("zip bytes mismatch: len got=%d want=%d", len(got), len(data))
	}

	// No part-* leftover files.
	matches, _ := filepath.Glob(filepath.Join(s.chunkDir(sess.TourID), "part-*"))
	if len(matches) != 0 {
		t.Fatalf("unexpected part files: %v", matches)
	}
}

func TestIngestParallelWrites(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(8 * 1024)
	const chunkSize = 1024
	sess := initSession(t, s, "tour-parallel", data, chunkSize)

	var wg sync.WaitGroup
	errCh := make(chan error, sess.TotalChunks)
	for n := 1; n <= sess.TotalChunks; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			start := int64(n-1) * chunkSize
			end := start + chunkSize
			if end > int64(len(data)) {
				end = int64(len(data))
			}
			_, err := s.WriteChunk(sess.TourID, n, bytes.NewReader(data[start:end]))
			if err != nil {
				errCh <- err
			}
		}(n)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("parallel WriteChunk: %v", err)
	}

	out, err := s.Assemble(sess.TourID)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	got, err := os.ReadFile(out.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("parallel write produced wrong ZIP contents")
	}
}

func TestIngestResumeMissingChunk(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(900)
	const chunkSize = 300
	sess := initSession(t, s, "tour-resume", data, chunkSize)

	// Upload all but chunk 2.
	for n := 1; n <= sess.TotalChunks; n++ {
		if n == 2 {
			continue
		}
		start := int64(n-1) * chunkSize
		end := start + chunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		if _, err := s.WriteChunk(sess.TourID, n, bytes.NewReader(data[start:end])); err != nil {
			t.Fatalf("WriteChunk %d: %v", n, err)
		}
	}

	_, missing, err := s.Status(sess.TourID)
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != 2 {
		t.Fatalf("missing=%v want [2]", missing)
	}
	if _, err := s.Assemble(sess.TourID); err == nil {
		t.Fatal("Assemble should fail with missing chunk")
	}

	start := int64(1) * chunkSize
	end := start + chunkSize
	if _, err := s.WriteChunk(sess.TourID, 2, bytes.NewReader(data[start:end])); err != nil {
		t.Fatalf("resume chunk 2: %v", err)
	}
	out, err := s.Assemble(sess.TourID)
	if err != nil {
		t.Fatalf("Assemble after resume: %v", err)
	}
	got, _ := os.ReadFile(out.ZipPath)
	if !bytes.Equal(got, data) {
		t.Fatal("resumed ZIP mismatch")
	}
}

func TestIngestChunkRetryOverwrite(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(500)
	const chunkSize = 250
	sess := initSession(t, s, "tour-retry", data, chunkSize)

	start := int64(0)
	end := int64(chunkSize)
	// First write wrong bytes, then overwrite with correct.
	bad := bytes.Repeat([]byte{0xFF}, int(end-start))
	if _, err := s.WriteChunk(sess.TourID, 1, bytes.NewReader(bad)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.WriteChunk(sess.TourID, 1, bytes.NewReader(data[start:end])); err != nil {
		t.Fatal(err)
	}
	if _, err := s.WriteChunk(sess.TourID, 2, bytes.NewReader(data[end:])); err != nil {
		t.Fatal(err)
	}
	out, err := s.Assemble(sess.TourID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(out.ZipPath)
	if !bytes.Equal(got, data) {
		t.Fatal("retry overwrite mismatch")
	}
}

func TestIngestLegacyAssembleFallback(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(700)
	const chunkSize = 200
	totalChunks := (len(data) + int(chunkSize) - 1) / int(chunkSize)
	tourID := "tour-legacy"

	// Simulate a pre-upgrade session: part files, DirectWrite=false.
	sess := &IngestSession{
		TourID:      tourID,
		SessionID:   "old",
		Filename:    "old.zip",
		FileSize:    int64(len(data)),
		ChunkSize:   chunkSize,
		TotalChunks: totalChunks,
		Received:    make([]bool, totalChunks),
		DirectWrite: false,
		ZipPath:     filepath.Join(s.tempDir, tourID+".zip"),
	}
	if err := os.MkdirAll(s.chunkDir(tourID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(s.sessionPath(tourID)), 0o755); err != nil {
		t.Fatal(err)
	}
	tl := s.tourLock(tourID)
	tl.Lock()
	if err := s.saveLocked(sess); err != nil {
		tl.Unlock()
		t.Fatal(err)
	}
	tl.Unlock()

	for n := 1; n <= totalChunks; n++ {
		start := int64(n-1) * chunkSize
		end := start + chunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		if _, err := s.WriteChunk(tourID, n, bytes.NewReader(data[start:end])); err != nil {
			t.Fatalf("legacy WriteChunk %d: %v", n, err)
		}
		// Ensure part file exists.
		if _, err := os.Stat(s.chunkPath(tourID, n)); err != nil {
			t.Fatalf("part %d missing: %v", n, err)
		}
	}

	out, err := s.Assemble(tourID)
	if err != nil {
		t.Fatalf("legacy Assemble: %v", err)
	}
	got, err := os.ReadFile(out.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("legacy concat mismatch")
	}
}

func TestIngestShortChunkRejected(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(500)
	const chunkSize = 250
	sess := initSession(t, s, "tour-short", data, chunkSize)

	// First chunk must be full size.
	_, err := s.WriteChunk(sess.TourID, 1, bytes.NewReader(data[:100]))
	if err == nil {
		t.Fatal("expected short write error")
	}
}

func TestIngestAbortCleansZip(t *testing.T) {
	s := newTestStore(t)
	data := testZipPayload(300)
	sess := initSession(t, s, "tour-abort", data, 100)
	if _, err := s.WriteChunk(sess.TourID, 1, bytes.NewReader(data[:100])); err != nil {
		t.Fatal(err)
	}
	if err := s.Abort(sess.TourID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(sess.ZipPath); !os.IsNotExist(err) {
		t.Fatal("zip should be removed")
	}
	if _, err := os.Stat(s.sessionPath(sess.TourID)); !os.IsNotExist(err) {
		t.Fatal("session should be removed")
	}
}

func TestIngestRejectsNonZipMagic(t *testing.T) {
	s := newTestStore(t)
	// Payload without PK magic.
	data := bytes.Repeat([]byte{0xAB}, 200)
	const chunkSize = 100
	sess, err := s.Init(IngestSession{
		TourID:      "tour-badmagic",
		SessionID:   "s",
		Filename:    "x.zip",
		FileSize:    int64(len(data)),
		ChunkSize:   chunkSize,
		TotalChunks: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= 2; n++ {
		start := int64(n-1) * chunkSize
		end := start + chunkSize
		if _, err := s.WriteChunk(sess.TourID, n, bytes.NewReader(data[start:end])); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Assemble(sess.TourID); err == nil {
		t.Fatal("expected bad magic error")
	}
}

func TestCopyAt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "f.bin")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(20); err != nil {
		t.Fatal(err)
	}
	n, err := copyAt(f, 5, bytes.NewReader([]byte("HELLO")))
	f.Close()
	if err != nil || n != 5 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	got, _ := os.ReadFile(path)
	if string(got[5:10]) != "HELLO" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteChunkAtDrainsExtra(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "z.bin")
	f, _ := os.Create(path)
	_ = f.Truncate(10)
	f.Close()
	// Reader longer than maxLen — must not error if we drain.
	r := io.MultiReader(bytes.NewReader(bytes.Repeat([]byte{1}, 10)), bytes.NewReader([]byte{9, 9}))
	n, err := writeChunkAt(path, 1, 10, 10, r)
	if err != nil {
		t.Fatal(err)
	}
	if n != 10 {
		t.Fatalf("n=%d", n)
	}
}
