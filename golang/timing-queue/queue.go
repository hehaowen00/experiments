package timingqueue

import (
	"container/heap"
	"fmt"
	"sync"
	"time"
)

type Task struct {
	ID       string
	Meta map[string]string
	Deadline time.Time
}

type TimingQueue struct {
	queue    PriorityQueue
	mu       sync.RWMutex
	addChan  chan *Task
	stopChan chan struct{}
	signal   chan *Task
	taskMap  map[string]*Task
}

func NewTimingQueue() *TimingQueue {
	return &TimingQueue{
		queue:    make(PriorityQueue, 0),
		addChan:  make(chan *Task, 100),
		stopChan: make(chan struct{}),
		signal:   make(chan *Task, 100),
		taskMap:  make(map[string]*Task),
	}
}

func (tw *TimingQueue) AddTask(
	id string,
	deadline time.Time,
	meta map[string]string,
) error {
	tw.mu.Lock()
	defer tw.mu.Unlock()

	if _, exists := tw.taskMap[id]; exists {
		return fmt.Errorf("task with ID %s already exists", id)
	}

	task := &Task{
		ID:       id,
		Deadline: deadline,
		Meta: meta,
	}

	tw.taskMap[id] = task
	tw.addChan <- task
	
	return nil
}

func (tw *TimingQueue) RemoveTask(id string) bool {
	tw.mu.Lock()
	defer tw.mu.Unlock()

	_, exists := tw.taskMap[id]
	if !exists {
		return false
	}

	delete(tw.taskMap, id)

	for i, t := range tw.queue {
		if t.ID == id {
			heap.Remove(&tw.queue, i)
			return true
		}
	}

	return false
}

func (tw *TimingQueue) Signal() <-chan *Task{
	return tw.signal
}

func (tw *TimingQueue) Start() {
	heap.Init(&tw.queue)

	go func() {
		var timer *time.Timer
		timer = time.NewTimer(0)
		if !timer.Stop() {
			<-timer.C
		}
		defer timer.Stop()

		for {
			tw.mu.Lock()
			if tw.queue.Len() > 0 {
				nextTask := tw.queue[0]
				waitDuration := time.Until(nextTask.Deadline)

				if waitDuration <= 0 {
					tw.signalTask(nextTask)
					heap.Pop(&tw.queue)
					delete(tw.taskMap, nextTask.ID)
					tw.mu.Unlock()
					continue
				}

				timer.Reset(waitDuration)
				tw.mu.Unlock()

				select {
				case <-timer.C:
					tw.mu.Lock()
					if tw.queue.Len() > 0 {
						task := heap.Pop(&tw.queue).(*Task)
						if _, exists := tw.taskMap[task.ID]; exists {
							tw.signalTask(task)
							delete(tw.taskMap, task.ID)
						}
					}
					tw.mu.Unlock()

				case newTask := <-tw.addChan:
					tw.mu.Lock()
					heap.Push(&tw.queue, newTask)
					tw.mu.Unlock()

				case <-tw.stopChan:
					return
				}
			} else {
				tw.mu.Unlock()
				select {
				case newTask := <-tw.addChan:
					tw.mu.Lock()
					heap.Push(&tw.queue, newTask)
					tw.mu.Unlock()

				case <-tw.stopChan:
					return
				}
			}
		}
	}()
}

func (tw *TimingQueue) signalTask(task *Task) {
	task2 := &Task{}
	*task2 = *task
	tw.signal <- task2
}

func (tw *TimingQueue) Stop() {
	close(tw.stopChan)
	close(tw.signal)
}

func (tw *TimingQueue) GetNextTaskTime() *time.Time {
	tw.mu.RLock()
	defer tw.mu.RUnlock()
	
	if tw.queue.Len() > 0 {
		return &tw.queue[0].Deadline
	}
	return nil
}

func (tw *TimingQueue) TaskCount() int {
	tw.mu.RLock()
	defer tw.mu.RUnlock()
	return tw.queue.Len()
}

func (tw *TimingQueue) HasTask(id string) bool {
	tw.mu.RLock()
	defer tw.mu.RUnlock()
	_, exists := tw.taskMap[id]
	return exists
}

type PriorityQueue []*Task

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	return pq[i].Deadline.Before(pq[j].Deadline)
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
}

func (pq *PriorityQueue) Push(x any) {
	*pq = append(*pq, x.(*Task))
}

func (pq *PriorityQueue) Pop() any {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[0 : n-1]
	return item
}

