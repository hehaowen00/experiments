package main

import (
	"log"
	"sync"
	"time"
)

type safeLocker struct {
	mu        sync.RWMutex
	initMutex sync.Mutex
	initCond  *sync.Cond
	created   bool
}

var locks = map[string]*safeLocker{}
var globalLock = sync.Mutex{}

func getOrCreateLocker(name string) *safeLocker {
	globalLock.Lock()
	l, ok := locks[name]
	globalLock.Unlock()

	if ok {
		l.initMutex.Lock()
		for !l.created {
			log.Printf("waiting for locker '%s' to be initialized", name)
			l.initCond.Wait()
		}
		l.initMutex.Unlock()
		return l
	}

	newLocker := &safeLocker{}
	newLocker.initCond = sync.NewCond(&newLocker.initMutex)

	globalLock.Lock()
	l, ok = locks[name]
	if ok {
		globalLock.Unlock()
		l.initMutex.Lock()
		for !l.created {
			log.Printf("(late) waiting for locker '%s' to be initialized", name)
			l.initCond.Wait()
		}
		l.initMutex.Unlock()
		return l
	}

	locks[name] = newLocker
	globalLock.Unlock()

	time.Sleep(100 * time.Millisecond)

	newLocker.initMutex.Lock()
	newLocker.created = true
	log.Printf("Locker for '%s' initialized", name)
	newLocker.initCond.Broadcast()
	newLocker.initMutex.Unlock()

	return newLocker
}

func lock(name string) {
	l := getOrCreateLocker(name)
	log.Println("lock", name)
	l.mu.Lock()
}

func unlock(name string) {
	globalLock.Lock()
	l, ok := locks[name]
	globalLock.Unlock()

	log.Println("unlock", name)

	if !ok {
		return
	}

	l.mu.Unlock()
}

func rlock(name string) {
	l := getOrCreateLocker(name)
	log.Println("rlock", name)
	l.mu.RLock()
}

func runlock(name string) {
	globalLock.Lock()
	l, ok := locks[name]
	globalLock.Unlock()

	log.Println("runlock", name)

	if !ok {
		return
	}

	l.mu.RUnlock()
}

func main() {
	list := []string{"a", "b", "c", "d"}
	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		for _, v := range list {
			lock(v)
			unlock(v)
		}
	}()

	go func() {
		defer wg.Done()
		for _, v := range list {
			rlock(v)
			runlock(v)
			lock(v)
			unlock(v)
		}
	}()

	go func() {
		defer wg.Done()
		for _, v := range list {
			lock(v)
			unlock(v)
			rlock(v)
			runlock(v)
		}
	}()

	for _, v := range list {
		rlock(v)
		runlock(v)
	}

	wg.Wait()
}
