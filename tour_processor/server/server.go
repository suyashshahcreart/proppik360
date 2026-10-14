// Package server implements the HTTP server for the Go processor.
//
// Endpoints:
//   POST /jobs    — receive a processing job from the Cloudflare Worker
//   GET  /health  — health check (always returns 200 OK)
//
// Authentication: the Worker sends X-Processor-Secret on all calls.
// The server validates it against the PROCESSOR_SECRET env var.
package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"tour-processor/processor"
)

// Server holds dependencies for all HTTP handlers.
type Server struct {
	secret   string
	jobQueue *processor.JobQueue
	ingest   *processor.IngestStore
}

// New creates a Server with the given secret and a bounded-concurrency job queue.
func New(secret string, jobQueue *processor.JobQueue, ingest *processor.IngestStore) *Server {
	return &Server{secret: secret, jobQueue: jobQueue, ingest: ingest}
}

// Handler returns the http.Handler for the server.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/jobs", s.handleJobs)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("POST /ingest/{tourId}/init", s.handleIngestInit)
	mux.HandleFunc("PUT /ingest/{tourId}/chunk/{n}", s.handleIngestChunk)
	mux.HandleFunc("POST /ingest/{tourId}/complete", s.handleIngestComplete)
	mux.HandleFunc("GET /ingest/{tourId}/status", s.handleIngestStatus)
	mux.HandleFunc("POST /ingest/{tourId}/abort", s.handleIngestAbort)
	return mux
}

// handleJobs accepts POST /jobs requests from the Worker.
//
//	Request body: { "tourId": "..." }
//
// The job runs asynchronously — the handler returns 202 Accepted immediately
// so the Worker's fire-and-forget call doesn't time out.
func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate shared secret
	secret := r.Header.Get("X-Processor-Secret")
	if secret == "" || secret != s.secret {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		TourID string `json:"tourId"`
		Phase  string `json:"phase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.TourID) == "" {
		http.Error(w, "invalid JSON body — tourId is required", http.StatusBadRequest)
		return
	}

	tourID := strings.TrimSpace(body.TourID)
	phase := strings.TrimSpace(body.Phase)
	log.Printf("[server] Received job for tour=%s phase=%q", tourID, phase)

	enqueued := s.jobQueue.EnqueuePhase(tourID, phase)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "accepted",
		"tourId":   tourID,
		"duplicate": !enqueued,
	})
}

// handleHealth is a simple liveness probe.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
