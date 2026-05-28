import { WebSocketServer, WebSocket } from 'ws';
import { createHmac, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_CONNECTIONS_PER_KEY = 5;
const MAX_QUEUE_SIZE = 100;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MSG_ENCRYPTION_SECRET = process.env.WS_MSG_SECRET || randomBytes(32).toString('hex');

// ── State ─────────────────────────────────────────────────────────────────────
let wss = null;

/** publicKey → Set<ws> */
const subscriptions = new Map();

/** publicKey → pending message queue (for offline/reconnect delivery) */
const messageQueues = new Map();

/** Analytics counters */
const stats = {
  totalConnections: 0,
  activeConnections: 0,
  messagesDelivered: 0,
  messagesQueued: 0,
  authFailures: 0,
  errors: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function signPayload(payload) {
  return createHmac('sha256', MSG_ENCRYPTION_SECRET)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
}

function buildEnvelope(payload) {
  const body = JSON.stringify(payload);
  const sig = signPayload(body);
  return JSON.stringify({ data: payload, sig });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

function enqueue(publicKey, payload) {
  if (!messageQueues.has(publicKey)) messageQueues.set(publicKey, []);
  const q = messageQueues.get(publicKey);
  if (q.length >= MAX_QUEUE_SIZE) q.shift(); // drop oldest
  q.push(payload);
  stats.messagesQueued++;
}

function flushQueue(publicKey, ws) {
  const q = messageQueues.get(publicKey);
  if (!q || q.length === 0) return;
  for (const payload of q) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buildEnvelope(payload));
      stats.messagesDelivered++;
    }
  }
  messageQueues.delete(publicKey);
}

function connectionCount(publicKey) {
  return subscriptions.get(publicKey)?.size ?? 0;
}

function removeClient(ws) {
  if (ws.subscribedKey) {
    subscriptions.get(ws.subscribedKey)?.delete(ws);
    if (subscriptions.get(ws.subscribedKey)?.size === 0) {
      subscriptions.delete(ws.subscribedKey);
    }
  }
  stats.activeConnections = Math.max(0, stats.activeConnections - 1);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    stats.totalConnections++;
    stats.activeConnections++;
    ws.isAlive = true;
    ws.authenticated = false;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, msg);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        stats.errors++;
      }
    });

    ws.on('close', () => removeClient(ws));

    ws.on('error', (err) => {
      logger.error('ws.error', { message: err.message });
      stats.errors++;
      removeClient(ws);
    });
  });

  // Heartbeat — detect and terminate stale connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        removeClient(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  logger.info('ws.initialized');
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'auth':
      return handleAuth(ws, msg);
    case 'subscribe':
      return handleSubscribe(ws, msg);
    case 'unsubscribe':
      return handleUnsubscribe(ws, msg);
    case 'ping':
      return ws.send(JSON.stringify({ type: 'pong' }));
    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

function handleAuth(ws, msg) {
  const jwtSecret = process.env.JWT_SECRET;
  // If no JWT_SECRET configured, allow unauthenticated (dev mode)
  if (!jwtSecret) {
    ws.authenticated = true;
    ws.send(JSON.stringify({ type: 'auth_ok' }));
    return;
  }
  const claims = verifyToken(msg.token);
  if (!claims) {
    stats.authFailures++;
    ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid or expired token' }));
    return;
  }
  ws.authenticated = true;
  ws.userId = claims.sub ?? claims.userId;
  ws.send(JSON.stringify({ type: 'auth_ok' }));
}

function handleSubscribe(ws, msg) {
  if (process.env.JWT_SECRET && !ws.authenticated) {
    ws.send(JSON.stringify({ type: 'error', message: 'Authenticate first' }));
    return;
  }
  const { publicKey } = msg;
  if (!publicKey) {
    ws.send(JSON.stringify({ type: 'error', message: 'publicKey required' }));
    return;
  }
  if (connectionCount(publicKey) >= MAX_CONNECTIONS_PER_KEY) {
    ws.send(JSON.stringify({ type: 'error', message: 'Connection limit reached for this account' }));
    return;
  }
  if (!subscriptions.has(publicKey)) subscriptions.set(publicKey, new Set());
  subscriptions.get(publicKey).add(ws);
  ws.subscribedKey = publicKey;
  ws.send(JSON.stringify({ type: 'subscribed', publicKey }));
  // Deliver any queued messages
  flushQueue(publicKey, ws);
}

function handleUnsubscribe(ws, msg) {
  const key = msg.publicKey ?? ws.subscribedKey;
  if (key) subscriptions.get(key)?.delete(ws);
  ws.subscribedKey = null;
  ws.send(JSON.stringify({ type: 'unsubscribed' }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Broadcast a payload to all subscribers of a publicKey.
 * If no subscribers are connected, the message is queued for later delivery.
 */
export function broadcastToAccount(publicKey, payload) {
  const clients = subscriptions.get(publicKey);
  if (!clients || clients.size === 0) {
    enqueue(publicKey, payload);
    return;
  }
  const envelope = buildEnvelope(payload);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(envelope);
      stats.messagesDelivered++;
    }
  });
}

/** Returns live WebSocket analytics for monitoring dashboards. */
export function getWsStats() {
  return {
    ...stats,
    subscribedAccounts: subscriptions.size,
    queuedAccounts: messageQueues.size,
    totalQueued: [...messageQueues.values()].reduce((s, q) => s + q.length, 0),
  };
}
