package service

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Service provides a high-level microservice abstraction over a Transport.
type Service struct {
	name      string
	transport Transport
	handlers  map[string]func(req *Request) *Response
	mu        sync.RWMutex
}

// NewService creates a new Service with the given name and transport.
func NewService(name string, transport Transport) *Service {
	return &Service{
		name:      name,
		transport: transport,
		handlers:  make(map[string]func(req *Request) *Response),
	}
}

// Handle registers a handler for the specified method.
func (s *Service) Handle(method string, handler func(req *Request) *Response) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = handler
}

// Start subscribes to the service topic "svc.<name>" and begins dispatching
// incoming requests to registered handlers.
func (s *Service) Start() error {
	topic := fmt.Sprintf("svc.%s", s.name)

	return s.transport.Subscribe(topic, func(data []byte) []byte {
		req, err := DecodeRequest(data)
		if err != nil {
			resp := &Response{Error: fmt.Sprintf("failed to decode request: %v", err)}
			encoded, _ := EncodeResponse(resp)
			return encoded
		}

		s.mu.RLock()
		handler, ok := s.handlers[req.Method]
		s.mu.RUnlock()

		var resp *Response
		if !ok {
			resp = &Response{Error: fmt.Sprintf("unknown method: %s", req.Method)}
		} else {
			resp = handler(req)
			if resp == nil {
				resp = &Response{}
			}
		}

		encoded, err := EncodeResponse(resp)
		if err != nil {
			errResp := &Response{Error: fmt.Sprintf("failed to encode response: %v", err)}
			encoded, _ = EncodeResponse(errResp)
		}
		return encoded
	})
}

// Call sends a request to the specified service and method, waiting for a response.
func (s *Service) Call(ctx context.Context, service, method string, payload []byte, timeout time.Duration) (*Response, error) {
	req := &Request{
		Service: service,
		Method:  method,
		Payload: payload,
	}

	data, err := EncodeRequest(req)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	topic := fmt.Sprintf("svc.%s", service)
	respData, err := s.transport.Request(ctx, topic, data, timeout)
	if err != nil {
		return nil, fmt.Errorf("request to %s.%s failed: %w", service, method, err)
	}

	resp, err := DecodeResponse(respData)
	if err != nil {
		return nil, fmt.Errorf("failed to decode response from %s.%s: %w", service, method, err)
	}

	return resp, nil
}

// Stop shuts down the service transport.
func (s *Service) Stop() error {
	return s.transport.Close()
}
