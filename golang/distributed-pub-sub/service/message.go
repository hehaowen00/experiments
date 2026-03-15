package service

import "encoding/json"

// Request represents a service request.
type Request struct {
	Service string            `json:"service"`
	Method  string            `json:"method"`
	Payload []byte            `json:"payload"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Response represents a service response.
type Response struct {
	Payload []byte            `json:"payload"`
	Error   string            `json:"error,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// EncodeRequest serializes a Request to JSON bytes.
func EncodeRequest(req *Request) ([]byte, error) {
	return json.Marshal(req)
}

// DecodeRequest deserializes a Request from JSON bytes.
func DecodeRequest(data []byte) (*Request, error) {
	var req Request
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

// EncodeResponse serializes a Response to JSON bytes.
func EncodeResponse(resp *Response) ([]byte, error) {
	return json.Marshal(resp)
}

// DecodeResponse deserializes a Response from JSON bytes.
func DecodeResponse(data []byte) (*Response, error) {
	var resp Response
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
