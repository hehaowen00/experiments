// Package service provides a microservice DX layer on top of the pubsub mesh.
//
// Services declare a namespace and register handlers. The package maps
// everything to pubsub topics automatically:
//
//   - Handle("method", fn)  → subscribes to {ns}.{method}, replies via Request/Reply
//   - On("event", fn)       → subscribes to {ns}.{event}
//   - Emit(ctx, "event", d) → publishes to {ns}.{event}
//   - Send(ctx, "bob", d)   → publishes to {ns}._inbox.{clientID}
//   - Call(ctx, "svc.m", d) → Request/Reply to topic {svc}.{m}
//
// Services are decoupled from the pubsub node via the Transport interface.
// Use EmbeddedTransport to wrap a *pubsub.Node in-process, or
// RemoteTransport to connect to a standalone mesh node's gateway over
// HTTP/WebSocket.
//
// Client wraps a connected user/caller. It scopes operations to the service
// namespace and subscribes to a personal inbox for direct messages.
//
//	alice := svc.Client("alice")
//	alice.OnMessage(handler)               // receives messages sent via svc.Send(ctx, "alice", ...)
//	alice.On("room.general", handler)      // subscribes to chat.room.general
//	alice.Emit(ctx, "room.general", data)  // publishes to chat.room.general
//	alice.Call(ctx, "send", payload)        // RPC to chat.send
//	alice.Close()                           // unsubscribes everything
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// HandlerFunc processes an incoming message. Return nil to ack, error to retry.
type HandlerFunc func(ctx *Context) error

// Middleware wraps a HandlerFunc. Use with Service.Use to add cross-cutting
// concerns (persistence, logging, metrics) to all handlers.
type Middleware func(HandlerFunc) HandlerFunc

// Context is passed to handlers with helpers for reading the payload and
// replying to requests.
type Context struct {
	context.Context
	msg       *Message
	transport Transport
	svc       *Service
}

// Bind JSON-decodes the payload into v.
func (c *Context) Bind(v any) error { return json.Unmarshal(c.msg.Payload, v) }

// Payload returns the raw JSON payload.
func (c *Context) Payload() json.RawMessage { return c.msg.Payload }

// Source returns the sender identity.
func (c *Context) Source() string { return c.msg.Source }

// Topic returns the destination topic.
func (c *Context) Topic() string { return c.msg.Topic }

// MessageID returns the unique message ID.
func (c *Context) MessageID() string { return c.msg.ID }

// Timestamp returns the message timestamp in milliseconds since epoch.
func (c *Context) Timestamp() int64 { return c.msg.Timestamp }

// Reply sends a response back to a Request/Reply caller. Only valid inside
// Handle handlers (messages with a ReplyTo field).
func (c *Context) Reply(data any) error {
	if c.msg.ReplyTo == "" {
		return fmt.Errorf("message has no ReplyTo field")
	}
	payload, err := marshal(data)
	if err != nil {
		return err
	}
	_, err = c.transport.Reply(c, c.msg.ReplyTo, c.svc.id, payload)
	return err
}

// registration is a handler registered before Start.
type registration struct {
	topic string
	subID string
	fn    HandlerFunc
}

// Service is a named microservice built on a Transport.
type Service struct {
	namespace string
	id        string
	transport Transport

	mu         sync.Mutex
	regs       []registration
	middleware []Middleware
	started    bool
}

// New creates a service with the given namespace using the given transport.
func New(namespace string, transport Transport, id string) *Service {
	return &Service{
		namespace: namespace,
		id:        namespace + "." + id,
		transport: transport,
	}
}

// Namespace returns the service namespace.
func (s *Service) Namespace() string { return s.namespace }

// Use adds middleware that wraps every handler registered via Handle and On.
// Middleware is applied in the order given: Use(A, B) means A runs first.
// Must be called before Start.
func (s *Service) Use(mw ...Middleware) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.middleware = append(s.middleware, mw...)
}

// Handle registers an RPC handler for {namespace}.{method}. The handler can
// call ctx.Reply() to send a response back to the caller.
func (s *Service) Handle(method string, fn HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	topic := s.topic(method)
	s.regs = append(s.regs, registration{
		topic: topic,
		subID: s.id + ".rpc." + method,
		fn:    fn,
	})
}

// On subscribes to {namespace}.{event}. Use for fan-out events that don't
// need a reply.
func (s *Service) On(event string, fn HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	topic := s.topic(event)
	s.regs = append(s.regs, registration{
		topic: topic,
		subID: s.id + ".evt." + event,
		fn:    fn,
	})
}

// Start subscribes all registered handlers on the transport.
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return fmt.Errorf("service %s already started", s.namespace)
	}

	for _, r := range s.regs {
		// Apply middleware chain (outermost first)
		final := r.fn
		for i := len(s.middleware) - 1; i >= 0; i-- {
			final = s.middleware[i](final)
		}
		handler := func(c context.Context, msg *Message) error {
			return final(&Context{
				Context:   c,
				msg:       msg,
				transport: s.transport,
				svc:       s,
			})
		}
		if err := s.transport.Subscribe(r.topic, r.subID, handler); err != nil {
			return fmt.Errorf("subscribe %s: %w", r.topic, err)
		}
	}

	s.started = true
	return nil
}

// Stop unsubscribes all handlers.
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.regs {
		s.transport.Unsubscribe(r.topic, r.subID)
	}
	s.started = false
	return nil
}

// Emit publishes an event to {namespace}.{event}.
func (s *Service) Emit(ctx context.Context, event string, data any) error {
	payload, err := marshal(data)
	if err != nil {
		return err
	}
	_, err = s.transport.Publish(ctx, s.id, s.topic(event), payload)
	return err
}

// Send pushes a direct message to a client's inbox: {namespace}._inbox.{clientID}.
func (s *Service) Send(ctx context.Context, clientID string, data any) error {
	payload, err := marshal(data)
	if err != nil {
		return err
	}
	_, err = s.transport.Publish(ctx, s.id, s.inboxTopic(clientID), payload)
	return err
}

// Call performs a Request/Reply RPC. The method is a fully-qualified topic
// (e.g. "auth.verify"). Use Client.Call for namespace-scoped calls.
func (s *Service) Call(ctx context.Context, method string, data any) (json.RawMessage, error) {
	payload, err := marshal(data)
	if err != nil {
		return nil, err
	}
	reply, err := s.transport.Request(ctx, s.id, method, payload)
	if err != nil {
		return nil, err
	}
	return reply.Payload, nil
}

// CallStream initiates a streaming RPC to a fully-qualified method topic
// (e.g. "data.range"). Use Client.CallStream for namespace-scoped calls.
func (s *Service) CallStream(ctx context.Context, method string, data any) (*Stream, error) {
	return callStream(ctx, s.transport, s.id, method, data)
}

// callStream is the shared implementation for streaming RPCs. It uses
// Request/Reply for the initial handshake (ensuring cross-node routing works),
// then receives stream items on a temporary topic. The server handler should
// call ctx.Reply first, then stream items via ctx.Stream().
func callStream(ctx context.Context, transport Transport, source, topic string, data any) (*Stream, error) {
	streamTopic := "_stream." + uuid.New().String()

	// Raw buffer: transport handlers (possibly concurrent) write here
	rawCh := make(chan json.RawMessage, 64)
	// Output channel: sequential processor writes here
	outCh := make(chan StreamItem, 64)

	subID := source + ".stream." + streamTopic
	err := transport.Subscribe(streamTopic, subID, func(_ context.Context, msg *Message) error {
		select {
		case rawCh <- msg.Payload:
		case <-ctx.Done():
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Processor — receives batch message, unpacks items into outCh
	go func() {
		defer close(outCh)
		select {
		case payload, ok := <-rawCh:
			if !ok {
				return
			}
			var batch struct {
				Items []json.RawMessage `json:"_stream_items"`
			}
			json.Unmarshal(payload, &batch)
			for _, item := range batch.Items {
				select {
				case outCh <- StreamItem{Payload: item}:
				case <-ctx.Done():
					return
				}
			}
		case <-ctx.Done():
			return
		}
	}()

	// Build payload with _stream_to injected
	payload, err := marshal(data)
	if err != nil {
		transport.Unsubscribe(streamTopic, subID)
		return nil, err
	}

	var obj map[string]any
	if err := json.Unmarshal(payload, &obj); err != nil {
		obj = map[string]any{"_data": json.RawMessage(payload)}
	}
	obj["_stream_to"] = streamTopic
	finalPayload, _ := json.Marshal(obj)

	// Use Request/Reply for the initial call. This ensures the message is
	// routed correctly across nodes and the server has acknowledged.
	// The server should Reply() first, then stream items via Stream().
	_, err = transport.Request(ctx, source, topic, finalPayload)
	if err != nil {
		transport.Unsubscribe(streamTopic, subID)
		return nil, err
	}

	var once sync.Once
	return &Stream{
		Ch: outCh,
		closer: func() {
			once.Do(func() {
				transport.Unsubscribe(streamTopic, subID)
			})
		},
	}, nil
}

// Client creates a Client bound to this service for the given user/caller ID.
// The client can subscribe to events, make RPCs, and receive direct messages.
// Call Client.Close when done.
func (s *Service) Client(id string) *Client {
	return &Client{
		id:     id,
		source: s.namespace + ".client." + id,
		svc:    s,
	}
}

func (s *Service) topic(name string) string   { return s.namespace + "." + name }
func (s *Service) inboxTopic(id string) string { return s.namespace + "._inbox." + id }

// Client represents a connected user or caller scoped to a service namespace.
type Client struct {
	id     string
	source string // publish identity
	svc    *Service

	mu   sync.Mutex
	subs []clientSub
}

type clientSub struct {
	topic string
	subID string
}

// ID returns the client identifier.
func (c *Client) ID() string { return c.id }

// On subscribes to {namespace}.{event}.
func (c *Client) On(event string, fn HandlerFunc) error {
	topic := c.svc.topic(event)
	subID := c.source + ".evt." + event
	return c.subscribe(topic, subID, fn)
}

// OnMessage subscribes to direct messages on {namespace}._inbox.{clientID}.
func (c *Client) OnMessage(fn HandlerFunc) error {
	topic := c.svc.inboxTopic(c.id)
	subID := c.source + ".inbox"
	return c.subscribe(topic, subID, fn)
}

// Emit publishes to {namespace}.{event}.
func (c *Client) Emit(ctx context.Context, event string, data any) error {
	payload, err := marshal(data)
	if err != nil {
		return err
	}
	_, err = c.svc.transport.Publish(ctx, c.source, c.svc.topic(event), payload)
	return err
}

// Call makes an RPC to {namespace}.{method} and blocks until a reply is
// received or the context expires.
func (c *Client) Call(ctx context.Context, method string, data any) (json.RawMessage, error) {
	payload, err := marshal(data)
	if err != nil {
		return nil, err
	}
	reply, err := c.svc.transport.Request(ctx, c.source, c.svc.topic(method), payload)
	if err != nil {
		return nil, err
	}
	return reply.Payload, nil
}

// Close unsubscribes the client from all topics.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, s := range c.subs {
		c.svc.transport.Unsubscribe(s.topic, s.subID)
	}
	c.subs = nil
	return nil
}

func (c *Client) subscribe(topic, subID string, fn HandlerFunc) error {
	svc := c.svc
	handler := func(ctx context.Context, msg *Message) error {
		return fn(&Context{
			Context:   ctx,
			msg:       msg,
			transport: svc.transport,
			svc:       svc,
		})
	}
	if err := svc.transport.Subscribe(topic, subID, handler); err != nil {
		return err
	}
	c.mu.Lock()
	c.subs = append(c.subs, clientSub{topic, subID})
	c.mu.Unlock()
	return nil
}

// marshal converts data to json.RawMessage. If data is already json.RawMessage
// or []byte, it is used directly.
func marshal(data any) (json.RawMessage, error) {
	switch v := data.(type) {
	case json.RawMessage:
		return v, nil
	case []byte:
		return v, nil
	default:
		return json.Marshal(v)
	}
}

// --- Streaming ---

// StreamWriter is returned by Context.Stream(). Use Send to buffer items,
// then Close to flush them all to the caller in a single batch message.
type StreamWriter struct {
	topic     string
	source    string
	transport Transport
	ctx       context.Context
	items     []json.RawMessage
}

// Send buffers a single item for the stream.
func (sw *StreamWriter) Send(data any) error {
	payload, err := marshal(data)
	if err != nil {
		return err
	}
	sw.items = append(sw.items, payload)
	return nil
}

// Close flushes all buffered items as a single batch message to the caller.
func (sw *StreamWriter) Close() error {
	batch, _ := json.Marshal(map[string]any{
		"_stream_items": sw.items,
	})
	_, err := sw.transport.Publish(sw.ctx, sw.source, sw.topic, batch)
	return err
}

// Stream reads the _stream_to field from the request payload, sends a Reply
// to acknowledge the stream, and returns a StreamWriter that publishes items
// back to the caller's temporary topic. The caller is responsible for calling
// Close when done.
func (c *Context) Stream() (*StreamWriter, error) {
	var envelope struct {
		StreamTo string `json:"_stream_to"`
	}
	if err := json.Unmarshal(c.msg.Payload, &envelope); err != nil || envelope.StreamTo == "" {
		return nil, fmt.Errorf("request has no _stream_to field")
	}

	// Acknowledge the stream request via Reply so the caller's Request unblocks
	if c.msg.ReplyTo != "" {
		payload, _ := marshal(map[string]string{"_stream_id": envelope.StreamTo})
		c.transport.Reply(c, c.msg.ReplyTo, c.svc.id, payload)
	}

	// Use the stream topic as source so sequence numbers start fresh at 1,
	// independent of other publishes from this service. This prevents the
	// subscriber's per-source reorder logic from dropping items.
	return &StreamWriter{
		topic:     envelope.StreamTo,
		source:    envelope.StreamTo,
		transport: c.transport,
		ctx:       c,
	}, nil
}

// StreamItem is a single item received on a stream.
type StreamItem struct {
	Payload json.RawMessage
}

// Stream is returned by Client.CallStream. Read items from Ch until it is closed.
type Stream struct {
	Ch     <-chan StreamItem
	closer func()
}

// Close unsubscribes from the stream topic.
func (s *Stream) Close() { s.closer() }

// CallStream initiates a streaming RPC. It subscribes to a temporary topic,
// sends the request with _stream_to injected, and returns a Stream whose Ch
// yields items until the server closes the stream.
func (c *Client) CallStream(ctx context.Context, method string, data any) (*Stream, error) {
	return callStream(ctx, c.svc.transport, c.source, c.svc.topic(method), data)
}
