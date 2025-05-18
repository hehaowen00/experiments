package messagequeue

type Consumer struct {
	handler func([]byte) error
}

func (c *Consumer) Stop() error {
	return nil
}
