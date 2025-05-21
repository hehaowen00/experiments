package messagequeue

import (
	"context"
	"sync"
)

type Consumer struct {
	handler func(string, []byte) error
	ctx     context.Context
	cancel  context.CancelFunc
	once    sync.Once
}

func (c *Consumer) Stop() error {
	c.once.Do(func() {
		c.cancel()
	})
	return nil
}
