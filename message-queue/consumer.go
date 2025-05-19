package messagequeue

type Consumer struct {
	handler func(string, []byte) error
}

func (c *Consumer) Stop() error {
	return nil
}
