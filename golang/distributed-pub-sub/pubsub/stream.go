package pubsub

import (
	"sync"
	"time"
)

// pendingStream holds chunks until all parts arrive.
type pendingStream struct {
	chunks    map[uint32][]byte // chunkIndex -> payload fragment
	total     uint32
	received  uint32
	msg       *Message // template carrying source, dest, seq, etc.
	createdAt time.Time
}

// streamAssembler reassembles chunked messages.
type streamAssembler struct {
	mu      sync.Mutex
	streams map[string]*pendingStream // streamID -> pending
}

func newStreamAssembler() *streamAssembler {
	return &streamAssembler{streams: make(map[string]*pendingStream)}
}

// addChunk stores a chunk and returns the reassembled payload if all chunks
// have arrived. Returns nil if the stream is still incomplete.
func (sa *streamAssembler) addChunk(streamID string, index, total uint32, data []byte, template *Message) []byte {
	sa.mu.Lock()
	defer sa.mu.Unlock()

	ps, ok := sa.streams[streamID]
	if !ok {
		ps = &pendingStream{
			chunks:    make(map[uint32][]byte, total),
			total:     total,
			msg:       template,
			createdAt: time.Now(),
		}
		sa.streams[streamID] = ps
	}

	if _, dup := ps.chunks[index]; dup {
		return nil
	}
	ps.chunks[index] = data
	ps.received++

	if ps.received < ps.total {
		return nil
	}

	// All chunks received — reassemble in order
	size := 0
	for _, c := range ps.chunks {
		size += len(c)
	}
	payload := make([]byte, 0, size)
	for i := uint32(0); i < ps.total; i++ {
		payload = append(payload, ps.chunks[i]...)
	}

	delete(sa.streams, streamID)
	return payload
}

// cleanup removes incomplete streams older than maxAge.
func (sa *streamAssembler) cleanup(maxAge time.Duration) {
	sa.mu.Lock()
	defer sa.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, ps := range sa.streams {
		if ps.createdAt.Before(cutoff) {
			delete(sa.streams, id)
		}
	}
}

// splitPayload divides data into chunks of at most chunkSize bytes.
func splitPayload(data []byte, chunkSize int) [][]byte {
	if chunkSize <= 0 || len(data) <= chunkSize {
		return [][]byte{data}
	}
	var chunks [][]byte
	for len(data) > 0 {
		end := chunkSize
		if end > len(data) {
			end = len(data)
		}
		chunks = append(chunks, data[:end])
		data = data[end:]
	}
	return chunks
}
