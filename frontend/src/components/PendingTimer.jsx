import { useEffect, useState } from 'react';

function pendingMessage(elapsedMs) {
  if (elapsedMs <= 10000) return 'Expected in ~5 seconds';
  if (elapsedMs <= 30000) return 'Taking longer than usual…';
  return 'Delayed — network may be congested';
}

export function PendingTimer({ startTime }) {
  const [now, setNow] = useState(startTime);

  useEffect(() => {
    setNow(startTime);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return (
    <span className="pending-timer" role="status" aria-live="polite">
      {pendingMessage(now - startTime)}
    </span>
  );
}
