package messagequeue

import (
	"errors"
	"fmt"
)

var ErrTopicNotFound = errors.New("topic not found")

type Publisher struct {
	ex *Exchange
}

func (p *Publisher) Publish(topic string, msg []byte) (string, error) {
	p.ex.rw.RLock()
	t, ok := p.ex.topics[topic]
	if !ok {
		p.ex.rw.RUnlock()

		p.ex.rw.Lock()
		err := p.ex.CreateTopic(topic)
		if err != nil {
			p.ex.rw.Unlock()
			return "", fmt.Errorf("error creating topic - %w", err)
		}

		t, ok = p.ex.topics[topic]
	} else {
		p.ex.rw.RUnlock()
	}

	if !ok {
		return "", ErrTopicNotFound
	}

	return t.Send(msg)
}
