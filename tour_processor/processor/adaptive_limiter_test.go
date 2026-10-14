package processor

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAdaptiveSemaphoreResize(t *testing.T) {
	sem := NewAdaptiveSemaphore(2)

	sem.Acquire()
	sem.Acquire()

	var thirdEntered atomic.Bool
	go func() {
		sem.Acquire()
		thirdEntered.Store(true)
		sem.Release()
	}()

	time.Sleep(50 * time.Millisecond)
	if thirdEntered.Load() {
		t.Fatal("third acquire should block at limit=2")
	}

	sem.SetLimit(3)
	deadline := time.Now().Add(2 * time.Second)
	for !thirdEntered.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !thirdEntered.Load() {
		t.Fatal("third acquire should proceed after SetLimit(3)")
	}

	sem.Release()
	sem.Release()
}

func TestAdaptiveSemaphoreLowerLimit(t *testing.T) {
	sem := NewAdaptiveSemaphore(4)
	sem.Acquire()
	sem.Acquire()
	sem.SetLimit(1) // in-flight 2 > new limit — no new acquires until releases
	if sem.Limit() != 1 {
		t.Fatalf("limit=%d", sem.Limit())
	}
	var entered atomic.Bool
	go func() {
		sem.Acquire()
		entered.Store(true)
		sem.Release()
	}()
	time.Sleep(40 * time.Millisecond)
	if entered.Load() {
		t.Fatal("should not enter while inFlight > limit")
	}
	sem.Release()
	sem.Release()
	deadline := time.Now().Add(2 * time.Second)
	for !entered.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !entered.Load() {
		t.Fatal("should enter after releases")
	}
}

func TestUploadLimiterFixedMode(t *testing.T) {
	l := NewUploadLimiter(UploadLimiterConfig{
		Mode:          UploadLimiterFixed,
		Start:         42,
		Min:           10,
		Max:           800,
		HardMax:       1000,
		BudgetPercent: 70,
	})
	defer l.Stop()
	if l.Limit() != 42 {
		t.Fatalf("fixed limit=%d want 42", l.Limit())
	}
}

func TestUploadLimiterAIMDBackoffOnErrors(t *testing.T) {
	l := NewUploadLimiter(UploadLimiterConfig{
		Mode:           UploadLimiterAdaptive,
		Min:            100,
		Max:            400,
		Start:          200,
		HardMax:        500,
		BudgetPercent:  70,
		Step:           25,
		Interval:       time.Hour, // don't auto-tick
		WorkersPerCore: 100,
	})
	defer l.Stop()

	for i := 0; i < 5; i++ {
		l.RecordFailure()
	}
	l.tick()
	if l.Limit() >= 200 {
		t.Fatalf("expected backoff below 200, got %d", l.Limit())
	}
	if l.Limit() < 100 {
		t.Fatalf("should not go below min, got %d", l.Limit())
	}
}

func TestUploadLimiterAIMDClimb(t *testing.T) {
	l := NewUploadLimiter(UploadLimiterConfig{
		Mode:           UploadLimiterAdaptive,
		Min:            100,
		Max:            400,
		Start:          200,
		HardMax:        500,
		BudgetPercent:  70,
		Step:           25,
		Interval:       time.Hour,
		WorkersPerCore: 100,
	})
	defer l.Stop()

	for i := 0; i < 30; i++ {
		l.RecordSuccess(1024)
	}
	l.tick() // first window establishes baseline + climb
	if l.Limit() != 225 {
		t.Fatalf("after climb limit=%d want 225", l.Limit())
	}
}

func TestUploadLimiterParallelAcquire(t *testing.T) {
	l := NewUploadLimiter(UploadLimiterConfig{
		Mode:          UploadLimiterFixed,
		Start:         8,
		BudgetPercent: 70,
		HardMax:       100,
	})
	defer l.Stop()

	var wg sync.WaitGroup
	var maxInFlight atomic.Int32
	var cur atomic.Int32

	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l.Acquire()
			n := cur.Add(1)
			for {
				old := maxInFlight.Load()
				if int32(n) <= old || maxInFlight.CompareAndSwap(old, int32(n)) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			cur.Add(-1)
			l.Release()
		}()
	}
	wg.Wait()
	if maxInFlight.Load() > 8 {
		t.Fatalf("max in-flight=%d want ≤8", maxInFlight.Load())
	}
}

func TestResourceUploadCeilingRespectsBudget(t *testing.T) {
	cfg := UploadLimiterConfig{
		Min:            50,
		HardMax:        1000,
		BudgetPercent:  70,
		WorkersPerCore: 100,
	}
	ceil := resourceUploadCeiling(cfg)
	if ceil < 50 || ceil > 1000 {
		t.Fatalf("ceiling=%d out of range", ceil)
	}
}
