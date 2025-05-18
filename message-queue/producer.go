package messagequeue

type Publisher struct {
	ex *Exchange
}

func (p *Publisher) Publish(topic string, msg []byte) error {
	return nil
}
