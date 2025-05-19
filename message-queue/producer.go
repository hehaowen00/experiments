package messagequeue

type Publisher struct {
	ex *Exchange
}

func (p *Publisher) Publish(topic string, msg []byte) error {
	p.ex.rw.RLock()
	t, ok := p.ex.topics[topic]
	if !ok {
		p.ex.rw.RUnlock()

		p.ex.rw.Lock()
		err := p.ex.CreateTopic(topic)
		if err != nil {
			p.ex.rw.Unlock()
			return err
		}

		t, ok = p.ex.topics[topic]
	} else {
		p.ex.rw.RUnlock()
	}

	return t.Send(msg)
}
