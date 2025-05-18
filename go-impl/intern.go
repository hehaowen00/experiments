package go_impl

import "sync"

type StringIntern struct {
	cache *LRU[string, string]
}

func NewStringIntern(capacity int) *StringIntern {
	return &StringIntern{
		cache: NewLRU[string, string](capacity),
	}
}

func (in *StringIntern) Intern(s string) string {
	if v, ok := in.cache.Get(&s); ok {
		return *v
	}
	in.cache.Put(s, s)
	return s
}

type ConcurrentStringIntern struct {
	cache *LRU[string, string]
	mu    sync.Mutex
}

func NewConcurrentStringIntern(capacity int) *ConcurrentStringIntern {
	return &ConcurrentStringIntern{
		cache: NewLRU[string, string](capacity),
	}
}

func (in *ConcurrentStringIntern) Intern(s string) string {
	if v, ok := in.cache.Get(&s); ok {
		return *v
	}

	in.mu.Lock()
	in.cache.Put(s, s)
	in.mu.Unlock()
	return s
}
