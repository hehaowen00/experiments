package discovery

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/ipv4"
)

const (
	mdnsAddr        = "224.0.0.251:5353"
	mdnsGroup       = "224.0.0.251"
	mdnsPort        = 5353
	serviceName     = "_pubsub._tcp.local."
	queryInterval   = 5 * time.Second
)

// MDNS implements Discovery using multicast DNS.
type MDNS struct {
	mu     sync.Mutex
	conn   *net.UDPConn
	pconn  *ipv4.PacketConn
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewMDNS creates a new mDNS discovery instance.
func NewMDNS() *MDNS {
	return &MDNS{}
}

// Start begins advertising this node and discovering peers via mDNS.
func (m *MDNS) Start(ctx context.Context, advertiseAddr string) (<-chan string, error) {
	ctx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()

	addr, err := net.ResolveUDPAddr("udp4", mdnsAddr)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("resolve mdns addr: %w", err)
	}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: mdnsPort})
	if err != nil {
		cancel()
		return nil, fmt.Errorf("listen udp: %w", err)
	}

	pconn := ipv4.NewPacketConn(conn)

	group := net.ParseIP(mdnsGroup)
	ifaces, err := net.Interfaces()
	if err != nil {
		conn.Close()
		cancel()
		return nil, fmt.Errorf("list interfaces: %w", err)
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagMulticast != 0 {
			_ = pconn.JoinGroup(&iface, &net.UDPAddr{IP: group})
		}
	}

	_ = pconn.SetControlMessage(ipv4.FlagDst, true)

	m.mu.Lock()
	m.conn = conn
	m.pconn = pconn
	m.mu.Unlock()

	ch := make(chan string, 16)
	seen := make(map[string]struct{})
	var seenMu sync.Mutex

	responsePacket := buildMDNSResponse(advertiseAddr)

	// Listener goroutine: reads mDNS packets, extracts peer addresses.
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		buf := make([]byte, 65536)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
			n, _, err := conn.ReadFromUDP(buf)
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					continue
				}
				select {
				case <-ctx.Done():
					return
				default:
					continue
				}
			}

			peers := parseMDNSPeers(buf[:n])
			for _, peer := range peers {
				if peer == advertiseAddr {
					continue
				}
				seenMu.Lock()
				if _, ok := seen[peer]; !ok {
					seen[peer] = struct{}{}
					seenMu.Unlock()
					select {
					case ch <- peer:
					case <-ctx.Done():
						return
					}
				} else {
					seenMu.Unlock()
				}
			}
		}
	}()

	// Query goroutine: periodically sends mDNS queries and responds to announce self.
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()

		queryPacket := buildMDNSQuery()

		ticker := time.NewTicker(queryInterval)
		defer ticker.Stop()

		// Send initial query and response immediately.
		_, _ = conn.WriteToUDP(queryPacket, addr)
		_, _ = conn.WriteToUDP(responsePacket, addr)

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = conn.WriteToUDP(queryPacket, addr)
				_, _ = conn.WriteToUDP(responsePacket, addr)
			}
		}
	}()

	// Cleanup goroutine.
	go func() {
		<-ctx.Done()
		m.mu.Lock()
		if m.conn != nil {
			m.conn.Close()
		}
		m.mu.Unlock()
		m.wg.Wait()
		close(ch)
	}()

	return ch, nil
}

// Stop halts mDNS discovery.
func (m *MDNS) Stop() error {
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.wg.Wait()
	return nil
}

// buildMDNSQuery builds a minimal DNS query packet for _pubsub._tcp.local. SRV.
func buildMDNSQuery() []byte {
	var buf []byte

	// Header: ID=0, Flags=0 (standard query), QDCOUNT=1
	buf = append(buf, 0, 0) // ID
	buf = append(buf, 0, 0) // Flags
	buf = append(buf, 0, 1) // QDCOUNT
	buf = append(buf, 0, 0) // ANCOUNT
	buf = append(buf, 0, 0) // NSCOUNT
	buf = append(buf, 0, 0) // ARCOUNT

	// Question: _pubsub._tcp.local. SRV IN
	buf = appendDNSName(buf, serviceName)
	buf = append(buf, 0, 33) // Type SRV (33)
	buf = append(buf, 0, 1)  // Class IN

	return buf
}

// buildMDNSResponse builds a DNS response advertising our address via TXT record.
func buildMDNSResponse(advertiseAddr string) []byte {
	var buf []byte

	// Header: ID=0, Flags=0x8400 (response, authoritative), ANCOUNT=1
	buf = append(buf, 0, 0)    // ID
	buf = append(buf, 0x84, 0) // Flags: response + authoritative
	buf = append(buf, 0, 0)    // QDCOUNT
	buf = append(buf, 0, 1)    // ANCOUNT
	buf = append(buf, 0, 0)    // NSCOUNT
	buf = append(buf, 0, 0)    // ARCOUNT

	// Answer: TXT record with addr=<advertiseAddr>
	buf = appendDNSName(buf, serviceName)
	buf = append(buf, 0, 16) // Type TXT (16)
	buf = append(buf, 0, 1)  // Class IN
	// TTL: 120 seconds
	buf = append(buf, 0, 0, 0, 120)

	txtData := "addr=" + advertiseAddr
	// RDLENGTH = 1 (length byte) + len(txtData)
	rdlen := 1 + len(txtData)
	buf = append(buf, byte(rdlen>>8), byte(rdlen))
	buf = append(buf, byte(len(txtData)))
	buf = append(buf, []byte(txtData)...)

	return buf
}

// appendDNSName encodes a DNS name (e.g., "_pubsub._tcp.local.") into wire format.
func appendDNSName(buf []byte, name string) []byte {
	name = strings.TrimSuffix(name, ".")
	parts := strings.Split(name, ".")
	for _, part := range parts {
		buf = append(buf, byte(len(part)))
		buf = append(buf, []byte(part)...)
	}
	buf = append(buf, 0) // root label
	return buf
}

// parseMDNSPeers extracts peer addresses from TXT records in a DNS packet.
func parseMDNSPeers(data []byte) []string {
	if len(data) < 12 {
		return nil
	}

	flags := binary.BigEndian.Uint16(data[2:4])
	isResponse := flags&0x8000 != 0
	if !isResponse {
		return nil
	}

	qdcount := binary.BigEndian.Uint16(data[4:6])
	ancount := binary.BigEndian.Uint16(data[6:8])

	offset := 12

	// Skip questions.
	for i := 0; i < int(qdcount); i++ {
		offset = skipDNSName(data, offset)
		if offset < 0 || offset+4 > len(data) {
			return nil
		}
		offset += 4 // type + class
	}

	var peers []string

	// Parse answers looking for TXT records.
	for i := 0; i < int(ancount); i++ {
		offset = skipDNSName(data, offset)
		if offset < 0 || offset+10 > len(data) {
			return nil
		}

		rtype := binary.BigEndian.Uint16(data[offset : offset+2])
		offset += 2
		// class
		offset += 2
		// TTL
		offset += 4
		rdlen := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		offset += 2

		if offset+rdlen > len(data) {
			return nil
		}

		if rtype == 16 { // TXT
			peers = append(peers, parseTXTRecords(data[offset:offset+rdlen])...)
		}

		offset += rdlen
	}

	return peers
}

// parseTXTRecords extracts addr= values from DNS TXT record data.
func parseTXTRecords(data []byte) []string {
	var addrs []string
	off := 0
	for off < len(data) {
		tlen := int(data[off])
		off++
		if off+tlen > len(data) {
			break
		}
		txt := string(data[off : off+tlen])
		off += tlen
		if strings.HasPrefix(txt, "addr=") {
			addr := strings.TrimPrefix(txt, "addr=")
			if addr != "" {
				addrs = append(addrs, addr)
			}
		}
	}
	return addrs
}

// skipDNSName advances past a DNS name in wire format, handling compression pointers.
func skipDNSName(data []byte, offset int) int {
	if offset >= len(data) {
		return -1
	}
	for {
		if offset >= len(data) {
			return -1
		}
		l := int(data[offset])
		if l == 0 {
			return offset + 1
		}
		// Compression pointer: top 2 bits set.
		if l&0xC0 == 0xC0 {
			return offset + 2
		}
		offset += 1 + l
	}
}
