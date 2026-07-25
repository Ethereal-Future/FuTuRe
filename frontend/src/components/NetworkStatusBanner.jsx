import { memo } from 'react';

// Latency thresholds (ms). Below GOOD is green, up to WARNING is amber,
// above that is red. Kept as constants so they're easy to tune per-network.
const LATENCY_THRESHOLD_GOOD_MS = 200;
const LATENCY_THRESHOLD_WARNING_MS = 500;

function latencyLevel(latencyMs) {
  if (latencyMs == null) return 'timeout';
  if (latencyMs < LATENCY_THRESHOLD_GOOD_MS) return 'good';
  if (latencyMs <= LATENCY_THRESHOLD_WARNING_MS) return 'warning';
  return 'critical';
}

// Isolated so a latency-only update doesn't re-render the rest of the banner.
const LatencyIndicator = memo(function LatencyIndicator({ latencyMs }) {
  const level = latencyLevel(latencyMs);
  const label = level === 'timeout' ? 'Horizon: timeout' : `Horizon: ${latencyMs}ms${level === 'critical' ? ' ⚠️' : ''}`;

  return <span className={`latency-indicator latency-${level}`}>{label}</span>;
});

export function NetworkStatusBanner({ status }) {
  if (!status) return null;

  const online = status.online;

  return (
    <div className={`net-status-banner ${online ? 'online' : 'offline'}`}>
      <span className={`net-dot ${online ? 'online' : 'offline'}`} />
      <span>{online ? 'Connected' : 'Disconnected'}</span>
      <LatencyIndicator latencyMs={status.latencyMs ?? null} />
    </div>
  );
}
