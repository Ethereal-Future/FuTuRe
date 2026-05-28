import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT = 5;

export function useWebSocket(publicKey, onMessage) {
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'disconnected' | 'reconnecting'
  const ws = useRef(null);
  const attempts = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      attempts.current = 0;
      setStatus('connected');
      if (publicKey) socket.send(JSON.stringify({ type: 'subscribe', publicKey }));
      // Also subscribe to the shared rates channel for rateChange events
      socket.send(JSON.stringify({ type: 'subscribe', publicKey: 'rates' }));
    };

    socket.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        // Broadcast messages are wrapped in { data, sig }; direct messages are not
        onMessageRef.current?.(parsed.data ?? parsed);
      } catch (_) {}
    };

    socket.onclose = () => {
      setStatus('disconnected');
      if (attempts.current < MAX_RECONNECT) {
        attempts.current++;
        setStatus('reconnecting');
        setTimeout(connect, RECONNECT_DELAY);
      }
    };

    socket.onerror = () => socket.close();
  }, [publicKey]);

  useEffect(() => {
    connect();
    return () => {
      attempts.current = MAX_RECONNECT; // prevent reconnect on unmount
      ws.current?.close();
    };
  }, [connect]);

  // Re-subscribe when publicKey changes
  useEffect(() => {
    if (publicKey && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'subscribe', publicKey }));
    }
  }, [publicKey]);

  return status;
}
