package processor

import (
	"context"
	"log"
	"sync"
)

// JobQueue bounds how many tours are processed at the same time.
//
// A fixed number of dispatcher goroutines ("slots") pull tour IDs off an
// internal buffered channel and run them one at a time per slot. Extra
// jobs simply wait in the channel buffer until a slot frees up — no tour
// is ever dropped, they just queue.
//
// Duplicate Enqueue(tourID) calls are idempotent: if the tour is already
// queued or actively running, the second call is a no-op. This makes
// Worker reconcile / processor startup re-POSTs safe.
type JobQueue struct {
	tourIDs chan queuedJob
	cfg     AdminPipelineConfig

	mu     sync.Mutex
	active map[string]struct{} // queued or running (key = tourID or tourID|artifact)
}

type queuedJob struct {
	tourID      string
	artifactType string
	phase        string
}

// NewJobQueue creates a JobQueue with `maxConcurrent` dispatcher slots and
// starts them immediately. queueBuffer controls how many pending tours can
// wait before Enqueue starts blocking the caller (kept generous since the
// HTTP handler enqueues from its own goroutine, not the request goroutine).
func NewJobQueue(maxConcurrent int, queueBuffer int, cfg AdminPipelineConfig) *JobQueue {
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}
	if queueBuffer < maxConcurrent {
		queueBuffer = maxConcurrent
	}

	q := &JobQueue{
		tourIDs: make(chan queuedJob, queueBuffer),
		cfg:     cfg,
		active:  make(map[string]struct{}),
	}

	log.Printf("[queue] Starting job queue: maxConcurrentJobs=%d queueBuffer=%d", maxConcurrent, queueBuffer)

	for i := 1; i <= maxConcurrent; i++ {
		go q.dispatcher(i)
	}

	return q
}

func jobActiveKey(tourID, artifactType string) string {
	if artifactType == "" || artifactType == ArtifactTourViewer {
		return tourID
	}
	return tourID + "|" + artifactType
}

// Enqueue adds a tour to the queue with an empty phase (auto).
// Returns false if the tour is already queued or running (duplicate).
func (q *JobQueue) Enqueue(tourID string) bool {
	return q.EnqueuePhase(tourID, "")
}

// EnqueuePhase adds a tour. phase is "", "backup", or "cleanup".
func (q *JobQueue) EnqueuePhase(tourID, phase string) bool {
	return q.EnqueueArtifact(tourID, ArtifactTourViewer, phase)
}

// EnqueueArtifact queues a job for a specific artifact type (e.g. tour_admin).
func (q *JobQueue) EnqueueArtifact(tourID, artifactType, phase string) bool {
	if artifactType == "" {
		artifactType = ArtifactTourViewer
	}
	key := jobActiveKey(tourID, artifactType)

	q.mu.Lock()
	if _, exists := q.active[key]; exists {
		q.mu.Unlock()
		log.Printf("[queue] Skipping duplicate enqueue tour=%s artifact=%s (already queued/running)", tourID, artifactType)
		return false
	}
	q.active[key] = struct{}{}
	q.mu.Unlock()

	job := queuedJob{tourID: tourID, artifactType: artifactType, phase: phase}
	select {
	case q.tourIDs <- job:
		log.Printf("[queue] Enqueued tour=%s artifact=%s phase=%q (pending=%d)", tourID, artifactType, phase, len(q.tourIDs))
	default:
		log.Printf("[queue] Queue buffer full, waiting to enqueue tour=%s artifact=%s", tourID, artifactType)
		q.tourIDs <- job
	}
	return true
}

// Has returns whether a tour (viewer) is currently queued or running.
func (q *JobQueue) Has(tourID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, ok := q.active[jobActiveKey(tourID, ArtifactTourViewer)]
	return ok
}

func (q *JobQueue) markDone(tourID, artifactType string) {
	q.mu.Lock()
	delete(q.active, jobActiveKey(tourID, artifactType))
	q.mu.Unlock()
}

// dispatcher runs forever, processing one tour at a time as they arrive.
// `id` is only used for log readability.
func (q *JobQueue) dispatcher(id int) {
	for job := range q.tourIDs {
		log.Printf("[queue] dispatcher=%d picking up tour=%s artifact=%s phase=%q (still pending=%d)",
			id, job.tourID, job.artifactType, job.phase, len(q.tourIDs))
		if job.artifactType == ArtifactTourAdmin || job.phase == "publish_admin" {
			RunAdminPipeline(context.Background(), q.cfg, job.tourID)
		} else {
			RunPipeline(context.Background(), q.cfg.PipelineConfig, job.tourID, job.phase)
		}
		q.markDone(job.tourID, job.artifactType)
	}
}
