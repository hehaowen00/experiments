package pubsub

import (
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus"
)

// Stats tracks node metrics using atomic counters.
type Stats struct {
	MessagesPublished atomic.Int64
	MessagesDelivered atomic.Int64
	MessagesForwarded atomic.Int64
	MessagesFailed    atomic.Int64
	MessagesDLQ       atomic.Int64
	ActiveSubscribers atomic.Int64
	ConnectedPeers    atomic.Int64
}

// Snapshot returns all current stats as a map.
func (s *Stats) Snapshot() map[string]int64 {
	return map[string]int64{
		"messages_published":  s.MessagesPublished.Load(),
		"messages_delivered":  s.MessagesDelivered.Load(),
		"messages_forwarded":  s.MessagesForwarded.Load(),
		"messages_failed":     s.MessagesFailed.Load(),
		"messages_dlq":        s.MessagesDLQ.Load(),
		"active_subscribers":  s.ActiveSubscribers.Load(),
		"connected_peers":     s.ConnectedPeers.Load(),
	}
}

// statsCollector implements prometheus.Collector by reading from atomic Stats
// on each scrape. This avoids touching the hot path.
type statsCollector struct {
	stats *Stats

	publishedDesc  *prometheus.Desc
	deliveredDesc  *prometheus.Desc
	forwardedDesc  *prometheus.Desc
	failedDesc     *prometheus.Desc
	dlqDesc        *prometheus.Desc
	subscriberDesc *prometheus.Desc
	peersDesc      *prometheus.Desc
}

func newStatsCollector(stats *Stats) *statsCollector {
	return &statsCollector{
		stats:          stats,
		publishedDesc:  prometheus.NewDesc("pubsub_messages_published_total", "Total messages published", nil, nil),
		deliveredDesc:  prometheus.NewDesc("pubsub_messages_delivered_total", "Total messages delivered to subscribers", nil, nil),
		forwardedDesc:  prometheus.NewDesc("pubsub_messages_forwarded_total", "Total messages forwarded to peers", nil, nil),
		failedDesc:     prometheus.NewDesc("pubsub_messages_failed_total", "Total messages that failed delivery", nil, nil),
		dlqDesc:        prometheus.NewDesc("pubsub_messages_dlq_total", "Total messages sent to dead-letter queue", nil, nil),
		subscriberDesc: prometheus.NewDesc("pubsub_active_subscribers", "Number of active subscribers", nil, nil),
		peersDesc:      prometheus.NewDesc("pubsub_connected_peers", "Number of connected peers", nil, nil),
	}
}

func (c *statsCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.publishedDesc
	ch <- c.deliveredDesc
	ch <- c.forwardedDesc
	ch <- c.failedDesc
	ch <- c.dlqDesc
	ch <- c.subscriberDesc
	ch <- c.peersDesc
}

func (c *statsCollector) Collect(ch chan<- prometheus.Metric) {
	ch <- prometheus.MustNewConstMetric(c.publishedDesc, prometheus.CounterValue, float64(c.stats.MessagesPublished.Load()))
	ch <- prometheus.MustNewConstMetric(c.deliveredDesc, prometheus.CounterValue, float64(c.stats.MessagesDelivered.Load()))
	ch <- prometheus.MustNewConstMetric(c.forwardedDesc, prometheus.CounterValue, float64(c.stats.MessagesForwarded.Load()))
	ch <- prometheus.MustNewConstMetric(c.failedDesc, prometheus.CounterValue, float64(c.stats.MessagesFailed.Load()))
	ch <- prometheus.MustNewConstMetric(c.dlqDesc, prometheus.CounterValue, float64(c.stats.MessagesDLQ.Load()))
	ch <- prometheus.MustNewConstMetric(c.subscriberDesc, prometheus.GaugeValue, float64(c.stats.ActiveSubscribers.Load()))
	ch <- prometheus.MustNewConstMetric(c.peersDesc, prometheus.GaugeValue, float64(c.stats.ConnectedPeers.Load()))
}
