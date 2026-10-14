package server

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"tour-processor/processor"
)

func (s *Server) authorized(w http.ResponseWriter, r *http.Request) bool {
	secret := r.Header.Get("X-Processor-Secret")
	if secret == "" || secret != s.secret {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func (s *Server) handleIngestInit(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	tourID := strings.TrimSpace(r.PathValue("tourId"))
	var body struct {
		SessionID     string `json:"sessionId"`
		Filename      string `json:"filename"`
		FileSize      int64  `json:"fileSize"`
		ChunkSize     int64  `json:"chunkSize"`
		TotalChunks   int    `json:"totalChunks"`
		BackupVersion string `json:"backupVersion"`
		SaveBackupZip bool   `json:"saveBackupZip"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || tourID == "" {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	sess, err := s.ingest.Init(processor.IngestSession{
		TourID:        tourID,
		SessionID:     body.SessionID,
		Filename:      body.Filename,
		FileSize:      body.FileSize,
		ChunkSize:     body.ChunkSize,
		TotalChunks:   body.TotalChunks,
		BackupVersion: body.BackupVersion,
		SaveBackupZip: body.SaveBackupZip,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tourId":      sess.TourID,
		"sessionId":   sess.SessionID,
		"totalChunks": sess.TotalChunks,
		"zipPath":     sess.ZipPath,
	})
}

func (s *Server) handleIngestChunk(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	tourID := strings.TrimSpace(r.PathValue("tourId"))
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		http.Error(w, "invalid chunk number", http.StatusBadRequest)
		return
	}
	sess, err := s.ingest.WriteChunk(tourID, n, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"bytesReceived":  sess.BytesReceived,
		"receivedChunks": processor.ReceivedNumbers(sess),
	})
}

func (s *Server) handleIngestComplete(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	tourID := strings.TrimSpace(r.PathValue("tourId"))
	sess, err := s.ingest.Assemble(tourID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	enqueued := s.jobQueue.Enqueue(tourID)
	mode := "direct"
	if !sess.DirectWrite {
		mode = "legacy-concat"
	}
	log.Printf("[server] Ingest complete tour=%s bytes=%d mode=%s enqueued=%v", tourID, sess.BytesReceived, mode, enqueued)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"assembled": true,
		"zipPath":   sess.ZipPath,
		"enqueued":  enqueued,
	})
	_, _ = io.Copy(io.Discard, r.Body)
}

func (s *Server) handleIngestStatus(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	tourID := strings.TrimSpace(r.PathValue("tourId"))
	sess, missing, err := s.ingest.Status(tourID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId":      sess.SessionID,
		"bytesReceived":  sess.BytesReceived,
		"fileSize":       sess.FileSize,
		"totalChunks":    sess.TotalChunks,
		"receivedChunks": processor.ReceivedNumbers(sess),
		"missingChunks":  missing,
		"assembled":      sess.Assembled,
		"zipPath":        sess.ZipPath,
		"publishDone":    sess.PublishDone,
		"backupVerified": sess.BackupVerified,
		"backupKey":      sess.BackupKey,
	})
}

func (s *Server) handleIngestAbort(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	tourID := strings.TrimSpace(r.PathValue("tourId"))
	if err := s.ingest.Abort(tourID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"aborted": true})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
