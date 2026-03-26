import { WebSocketServer, WebSocket } from 'ws';

let wss = null;

// Map of publicKey -> Set of ws clients subscribed to that account
const subscriptions = new Map();

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe' && msg.publicKey) {
          if (!subscriptions.has(msg.publicKey)) subscriptions.set(msg.publicKey, new Set());
          subscriptions.get(msg.publicKey).add(ws);
          ws.subscribedKey = msg.publicKey;
          ws.send(JSON.stringify({ type: 'subscribed', publicKey: msg.publicKey }));
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (ws.subscribedKey) {
        subscriptions.get(ws.subscribedKey)?.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  });

  // Heartbeat to detect stale connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

export function broadcastToAccount(publicKey, payload) {
  const clients = subscriptions.get(publicKey);
  if (!clients) return;
  const msg = JSON.stringify(payload);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}
