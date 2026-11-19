import { useEffect, useRef, useState, useCallback } from 'react';

const WS_BASE = `ws://${window.location.hostname}:3001`;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const MAX_RECONNECT = 10;
// Application-level heartbeat: detects sockets silently dropped during device
// sleep / NAT timeouts, where readyState stays OPEN and onclose never fires.
export const HEARTBEAT_INTERVAL_MS = 30000;
export const PONG_TIMEOUT_MS = 10000;

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
  const heartbeatTimer = useRef(null);
  const pongTimer = useRef(null);
  const reconnectTimer = useRef(null);
  const unmounted = useRef(false);
  onMessageRef.current = onMessage;

  const stopHeartbeat = useCallback(() => {
    clearInterval(heartbeatTimer.current);
    clearTimeout(pongTimer.current);
    heartbeatTimer.current = null;
    pongTimer.current = null;
  }, []);

  const connectRef = useRef(null);

  const scheduleReconnect = useCallback(() => {
    if (unmounted.current || reconnectTimer.current) return;
    if (attempts.current >= MAX_RECONNECT) {
      setStatus('failed');
      return;
    }
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts.current), BACKOFF_MAX_MS);
    attempts.current++;
    setStatus('reconnecting');
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      connectRef.current?.();
    }, delay);
  }, []);

  // Tear down a dead socket without waiting for its close handshake, which may
  // never complete on a zombie connection, then reconnect with backoff.
  const dropSocket = useCallback((socket) => {
    stopHeartbeat();
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try { socket.close(); } catch (_) { /* already closed */ }
    if (ws.current === socket) ws.current = null;
    setStatus('disconnected');
    scheduleReconnect();
  }, [stopHeartbeat, scheduleReconnect]);

  const sendPing = useCallback(() => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (pongTimer.current) return; // a ping is already awaiting its pong
    try {
      socket.send(JSON.stringify({ type: 'ping' }));
    } catch (_) {
      dropSocket(socket);
      return;
    }
    pongTimer.current = setTimeout(() => {
      pongTimer.current = null;
      dropSocket(socket);
    }, PONG_TIMEOUT_MS);
  }, [dropSocket]);

  const connect = useCallback(() => {
    const state = ws.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;

    const socket = new WebSocket(buildWsUrl());
    ws.current = socket;

    socket.onopen = () => {
      attempts.current = 0;
      setStatus('connected');
      // JWT was validated at handshake; subscribe immediately.
      const since = lastEventTime.current;
      if (publicKey) socket.send(JSON.stringify({ type: 'subscribe', publicKey, ...(since ? { since } : {}) }));
      socket.send(JSON.stringify({ type: 'subscribe', publicKey: 'rates', ...(since ? { since } : {}) }));

      stopHeartbeat();
      heartbeatTimer.current = setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
    };

    socket.onmessage = (e) => {
      // Any inbound frame proves the connection is alive.
      clearTimeout(pongTimer.current);
      pongTimer.current = null;
      try {
        const parsed = JSON.parse(e.data);
        if (parsed?.type === 'pong') return;
        lastEventTime.current = Date.now();
        onMessageRef.current?.(parsed.data ?? parsed);
      } catch (_) { /* ignore parse errors */ }
    };

    socket.onclose = () => {
      stopHeartbeat();
      if (ws.current === socket) ws.current = null;
      setStatus('disconnected');
      scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }, [publicKey, sendPing, stopHeartbeat, scheduleReconnect]);

  connectRef.current = connect;

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true; // prevent reconnect on unmount
      stopHeartbeat();
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      const socket = ws.current;
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
        ws.current = null;
      }
    };
  }, [connect, stopHeartbeat]);

  // On wake (tab visible again) or network recovery, verify the connection
  // immediately instead of waiting for the next heartbeat tick.
  useEffect(() => {
    const checkHealth = (resetBackoff) => {
      if (unmounted.current) return;
      if (ws.current?.readyState === WebSocket.OPEN) {
        sendPing();
        return;
      }
      if (resetBackoff) attempts.current = 0;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      connect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkHealth(true);
    };
    const onOnline = () => checkHealth(true);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [connect, sendPing]);

  // Re-subscribe when publicKey changes
  useEffect(() => {
    if (publicKey && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'subscribe', publicKey }));
    }
  }, [publicKey]);

  return status;
}
