package processor

// Semaphore bounds the number of concurrent operations using a buffered channel.
//
// This is used as a GLOBAL cap on concurrent R2 upload requests across ALL
// tours being processed at once — independent of how many jobs are running
// or how many goroutines each job's worker pool spins up. Without this, N
// concurrent tours each running their own M-goroutine pool would produce
// N*M simultaneous requests, oversubscribing the network/CPU and slowing
// every tour down together (this is exactly what caused two tours uploaded
// around the same time to both process slower than either would alone).
type Semaphore struct {
	slots chan struct{}
}

// NewSemaphore creates a Semaphore that allows up to `size` concurrent holders.
func NewSemaphore(size int) *Semaphore {
	if size <= 0 {
		size = 1
	}
	return &Semaphore{slots: make(chan struct{}, size)}
}

// Acquire blocks until a slot is available.
func (s *Semaphore) Acquire() {
	s.slots <- struct{}{}
}

// Release frees a slot for another waiter.
func (s *Semaphore) Release() {
	<-s.slots
}
