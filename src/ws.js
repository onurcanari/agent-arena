// WebSocket endpoint that pushes state to every connected client every 5s.

import { WebSocketServer } from 'ws';
import { snapshot } from './state.js';

export function attachWs(server, { state, intervalMs = 5000 }) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = () => {
    const payload = JSON.stringify({ type: 'state', data: snapshot(state) });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch {
          // Ignore individual send failures; socket may have just closed.
        }
      }
    }
  };

  const timer = setInterval(broadcast, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  wss.on('connection', (socket) => {
    // Send an initial state immediately so clients don't wait for the first tick.
    try {
      socket.send(JSON.stringify({ type: 'state', data: snapshot(state) }));
    } catch {
      // ignore
    }
  });

  wss.on('close', () => {
    clearInterval(timer);
  });

  return wss;
}
