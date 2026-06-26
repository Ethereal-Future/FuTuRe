import { useEffect, useRef, useState, useCallback } from 'react';

const WS_BASE = `ws://${window.location.hostname}:3001`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT = 5;
const WS_URL = `ws://${window.location.hostname}:3001`;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const MAX_RECONNECT = 10;

function buildWsUrl() {
  const token = localStorage.getItem('accessToken');
  if (!token) return WS_BASE;
  return `${WS_BASE}?token=${encodeURIComponent(token)}`;
}

export function useWebSocket(publicKey, onMessage) {
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'disconnected' | 'reconnecting' | 'failed'
  const ws = useRef(null);
  const attempts = useRef(0);
  const onMessageRef = useRef(onMessage);
  const lastEventTime = useRef(null);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(buildWsUrl());
    ws.current = socket;

    socket.onopen = () => {
      attempts.current = 0;
      setStatus('connected');
      // JWT was validated at handshake; subscribe immediately.
      if (publicKey) socket.send(JSON.stringify({ type: 'subscribe', publicKey }));
      socket.send(JSON.stringify({ type: 'subscribe', publicKey: 'rates' }));
      const since = lastEventTime.current;
      if (publicKey) socket.send(JSON.stringify({ type: 'subscribe', publicKey, ...(since ? { since } : {}) }));
      socket.send(JSON.stringify({ type: 'subscribe', publicKey: 'rates', ...(since ? { since } : {}) }));
    };

    socket.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        lastEventTime.current = Date.now();
        onMessageRef.current?.(parsed.data ?? parsed);
      } catch (_) { /* ignore parse errors */ }
    };

    socket.onclose = () => {
      setStatus('disconnected');
      if (attempts.current < MAX_RECONNECT) {
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts.current), BACKOFF_MAX_MS);
        attempts.current++;
        setStatus('reconnecting');
        setTimeout(connect, delay);
      } else {
        setStatus('failed');
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
