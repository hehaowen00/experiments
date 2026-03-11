package pubsub

import (
	"log"
	"net"
	"time"
)

func (n *Node) dnsDiscoveryLoop() {
	n.discoverViaDNS()

	ticker := time.NewTicker(n.opts.DNSDiscoveryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			n.discoverViaDNS()
		case <-n.ctx.Done():
			return
		}
	}
}

func (n *Node) discoverViaDNS() {
	addrs, err := n.opts.Resolver.LookupHost(n.ctx, n.opts.DNSDiscovery)
	if err != nil {
		log.Printf("dns discovery lookup %s failed: %v", n.opts.DNSDiscovery, err)
		return
	}

	for _, ip := range addrs {
		addr := net.JoinHostPort(ip, n.opts.DNSDiscoveryPort)
		if addr == n.opts.AdvertiseAddr {
			continue
		}
		if err := n.addPeer(addr); err != nil {
			continue
		}
		// New peer — trigger Join to get its peer list
		go func(a string) {
			if err := n.joinViaSeed(a); err != nil {
				log.Printf("dns discovery join %s failed: %v", a, err)
			}
		}(addr)
	}
}
