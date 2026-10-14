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
	cfg     PipelineConfig

	mu     sync.Mutex
	active map[string]struct{} // queued or running
}

type queuedJob struct {
	tourID string
	phase  string
}

// NewJobQueue creates a JobQueue with `maxConcurrent` dispatcher slots and
// starts them immediately. queueBuffer controls how many pending tours can
// wait before Enqueue starts blocking the caller (kept generous since the
// HTTP handler enqueues from its own goroutine, not the request goroutine).
func NewJobQueue(maxConcurrent int, queueBuffer int, cfg PipelineConfig) *JobQueue {
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

// Enqueue adds a tour to the queue with an empty phase (auto).
// Returns false if the tour is already queued or running (duplicate).
func (q *JobQueue) Enqueue(tourID string) bool {
	return q.EnqueuePhase(tourID, "")
}

// EnqueuePhase adds a tour. phase is "", "backup", or "cleanup".
func (q *JobQueue) EnqueuePhase(tourID, phase string) bool {
	q.mu.Lock()
	if _, exists := q.active[tourID]; exists {
		q.mu.Unlock()
		log.Printf("[queue] Skipping duplicate enqueue tour=%s (already queued/running)", tourID)
		return false
	}
	q.active[tourID] = struct{}{}
	q.mu.Unlock()

	job := queuedJob{tourID: tourID, phase: phase}
	select {
	case q.tourIDs <- job:
		log.Printf("[queue] Enqueued tour=%s phase=%q (pending=%d)", tourID, phase, len(q.tourIDs))
	default:
		log.Printf("[queue] Queue buffer full, waiting to enqueue tour=%s", tourID)
		q.tourIDs <- job
	}
	return true
}

// Has returns whether a tour is currently queued or running.
func (q *JobQueue) Has(tourID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, ok := q.active[tourID]
	return ok
}

func (q *JobQueue) markDone(tourID string) {
	q.mu.Lock()
	delete(q.active, tourID)
	q.mu.Unlock()
}

// dispatcher runs forever, processing one tour at a time as they arrive.
// `id` is only used for log readability.
func (q *JobQueue) dispatcher(id int) {
	for job := range q.tourIDs {
		log.Printf("[queue] dispatcher=%d picking up tour=%s phase=%q (still pending=%d)", id, job.tourID, job.phase, len(q.tourIDs))
		RunPipeline(context.Background(), q.cfg, job.tourID, job.phase)
		q.markDone(job.tourID)
	}
}
