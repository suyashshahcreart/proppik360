package processor

import (
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// AdaptiveSemaphore is a resizable concurrency gate.
// SetLimit can raise or lower the cap while uploads are in flight;
// waiters wake when a slot frees or the limit increases.
type AdaptiveSemaphore struct {
	mu       sync.Mutex
	cond     *sync.Cond
	limit    int
	inFlight int
}

func NewAdaptiveSemaphore(limit int) *AdaptiveSemaphore {
	if limit < 1 {
		limit = 1
	}
	s := &AdaptiveSemaphore{limit: limit}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *AdaptiveSemaphore) Acquire() {
	s.mu.Lock()
	for s.inFlight >= s.limit {
		s.cond.Wait()
	}
	s.inFlight++
	s.mu.Unlock()
}

func (s *AdaptiveSemaphore) Release() {
	s.mu.Lock()
	if s.inFlight > 0 {
		s.inFlight--
	}
	s.cond.Signal()
	s.mu.Unlock()
}

func (s *AdaptiveSemaphore) SetLimit(n int) {
	if n < 1 {
		n = 1
	}
	s.mu.Lock()
	old := s.limit
	s.limit = n
	if n > old {
		s.cond.Broadcast()
	}
	s.mu.Unlock()
}

func (s *AdaptiveSemaphore) Limit() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.limit
}

func (s *AdaptiveSemaphore) InFlight() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inFlight
}

// UploadLimiterMode selects fixed vs adaptive R2 publish concurrency.
type UploadLimiterMode string

const (
	UploadLimiterFixed    UploadLimiterMode = "fixed"
	UploadLimiterAdaptive UploadLimiterMode = "adaptive"
)

// UploadLimiterConfig is loaded from env at process start.
type UploadLimiterConfig struct {
	Mode               UploadLimiterMode
	Min                int
	Max                int
	Start              int
	HardMax            int
	BudgetPercent      int // target share of machine resources (e.g. 70)
	Step               int // additive increase step
	Interval           time.Duration
	WorkersPerCore     float64 // used to derive CPU-based ceiling
}

// DefaultUploadLimiterConfig returns KVM8-oriented adaptive defaults.
func DefaultUploadLimiterConfig() UploadLimiterConfig {
	return UploadLimiterConfig{
		Mode:           UploadLimiterAdaptive,
		Min:            100,
		Max:            800,
		Start:          350,
		HardMax:        1000,
		BudgetPercent:  70,
		Step:           25,
		Interval:       3 * time.Second,
		WorkersPerCore: 100,
	}
}

// UploadLimiter gates global R2 uploads and optionally runs AIMD.
type UploadLimiter struct {
	cfg UploadLimiterConfig
	sem *AdaptiveSemaphore

	successes atomic.Int64
	failures  atomic.Int64
	bytes     atomic.Int64

	stopCh chan struct{}
	once   sync.Once

	// AIMD state (controller goroutine only)
	prevFilesPerSec float64
	holdStreak      int
}

// NewUploadLimiter builds a limiter. In fixed mode, Min/Max/Start collapse to Start.
func NewUploadLimiter(cfg UploadLimiterConfig) *UploadLimiter {
	cfg = normalizeUploadLimiterConfig(cfg)
	ceiling := resourceUploadCeiling(cfg)
	if cfg.Max > ceiling {
		cfg.Max = ceiling
	}
	if cfg.Start > cfg.Max {
		cfg.Start = cfg.Max
	}
	if cfg.Start < cfg.Min {
		cfg.Start = cfg.Min
	}

	l := &UploadLimiter{
		cfg:    cfg,
		sem:    NewAdaptiveSemaphore(cfg.Start),
		stopCh: make(chan struct{}),
	}

	log.Printf("[limiter] mode=%s start=%d min=%d max=%d hardMax=%d budget=%d%% cpuCeiling=%d cores=%d",
		cfg.Mode, cfg.Start, cfg.Min, cfg.Max, cfg.HardMax, cfg.BudgetPercent, ceiling, runtime.NumCPU())

	if cfg.Mode == UploadLimiterAdaptive {
		go l.controlLoop()
	}
	return l
}

func normalizeUploadLimiterConfig(cfg UploadLimiterConfig) UploadLimiterConfig {
	def := DefaultUploadLimiterConfig()
	if cfg.Mode != UploadLimiterFixed && cfg.Mode != UploadLimiterAdaptive {
		cfg.Mode = def.Mode
	}
	if cfg.Min <= 0 {
		cfg.Min = def.Min
	}
	if cfg.Max <= 0 {
		cfg.Max = def.Max
	}
	if cfg.Start <= 0 {
		cfg.Start = def.Start
	}
	if cfg.HardMax <= 0 {
		cfg.HardMax = def.HardMax
	}
	if cfg.BudgetPercent <= 0 || cfg.BudgetPercent > 100 {
		cfg.BudgetPercent = def.BudgetPercent
	}
	if cfg.Step <= 0 {
		cfg.Step = def.Step
	}
	if cfg.Interval <= 0 {
		cfg.Interval = def.Interval
	}
	if cfg.WorkersPerCore <= 0 {
		cfg.WorkersPerCore = def.WorkersPerCore
	}
	if cfg.Mode == UploadLimiterFixed {
		// Fixed: pin to Start (usually MAX_GLOBAL_UPLOAD_CONCURRENCY).
		cfg.Min = cfg.Start
		cfg.Max = cfg.Start
	}
	if cfg.Max > cfg.HardMax {
		cfg.Max = cfg.HardMax
	}
	if cfg.Min > cfg.Max {
		cfg.Min = cfg.Max
	}
	return cfg
}

// resourceUploadCeiling derives a CPU-budget-aware upper bound.
// R2 publish is connection-heavy; ~WorkersPerCore in-flight PUTs per core
// within BudgetPercent is a safe planning ceiling (not a live CPU sensor).
func resourceUploadCeiling(cfg UploadLimiterConfig) int {
	cores := runtime.NumCPU()
	if cores < 1 {
		cores = 1
	}
	ceil := int(float64(cores) * float64(cfg.BudgetPercent) / 100.0 * cfg.WorkersPerCore)
	if ceil < cfg.Min {
		ceil = cfg.Min
	}
	if ceil > cfg.HardMax {
		ceil = cfg.HardMax
	}
	return ceil
}

func (l *UploadLimiter) Acquire() { l.sem.Acquire() }
func (l *UploadLimiter) Release() { l.sem.Release() }

func (l *UploadLimiter) Limit() int { return l.sem.Limit() }

func (l *UploadLimiter) RecordSuccess(nBytes int64) {
	l.successes.Add(1)
	if nBytes > 0 {
		l.bytes.Add(nBytes)
	}
}

func (l *UploadLimiter) RecordFailure() {
	l.failures.Add(1)
}

func (l *UploadLimiter) Stop() {
	l.once.Do(func() { close(l.stopCh) })
}

func (l *UploadLimiter) controlLoop() {
	ticker := time.NewTicker(l.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-l.stopCh:
			return
		case <-ticker.C:
			l.tick()
		}
	}
}

func (l *UploadLimiter) tick() {
	succ := l.successes.Swap(0)
	fail := l.failures.Swap(0)
	nbytes := l.bytes.Swap(0)
	_ = nbytes

	elapsed := l.cfg.Interval.Seconds()
	if elapsed <= 0 {
		elapsed = 3
	}
	filesPerSec := float64(succ) / elapsed
	total := succ + fail
	var failRate float64
	if total > 0 {
		failRate = float64(fail) / float64(total)
	}

	cur := l.sem.Limit()
	next := cur
	reason := "hold"

	switch {
	case fail >= 3 || failRate >= 0.05:
		next = maxInt(l.cfg.Min, int(float64(cur)*0.7))
		reason = "backoff-errors"
		l.holdStreak = 0
	case succ == 0 && fail == 0:
		// Idle window (no publish activity) — keep current limit.
		reason = "idle"
	case l.prevFilesPerSec > 0 && filesPerSec < l.prevFilesPerSec*0.85 && cur > l.cfg.Min:
		next = maxInt(l.cfg.Min, cur-l.cfg.Step)
		reason = "throughput-drop"
		l.holdStreak = 0
	case l.prevFilesPerSec == 0 || filesPerSec >= l.prevFilesPerSec*1.02:
		next = minInt(l.cfg.Max, cur+l.cfg.Step)
		reason = "climb"
		l.holdStreak = 0
	default:
		// Plateau: occasional probe upward so we rediscover headroom.
		l.holdStreak++
		if l.holdStreak >= 4 && cur < l.cfg.Max {
			next = minInt(l.cfg.Max, cur+l.cfg.Step)
			reason = "probe"
			l.holdStreak = 0
		}
	}

	if next != cur {
		l.sem.SetLimit(next)
		log.Printf("[limiter] AIMD %s: %d→%d (files/s=%.1f prev=%.1f fail=%d failRate=%.1f%% inFlight=%d)",
			reason, cur, next, filesPerSec, l.prevFilesPerSec, fail, failRate*100, l.sem.InFlight())
	} else if succ > 0 || fail > 0 {
		log.Printf("[limiter] AIMD hold limit=%d (files/s=%.1f fail=%d inFlight=%d)",
			cur, filesPerSec, fail, l.sem.InFlight())
	}

	if succ > 0 || fail > 0 {
		l.prevFilesPerSec = filesPerSec
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
