// agent-arena backend entrypoint.
// Fastify v4 + CORS + static + JSON body + WS plugin.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createState } from './src/state.js';
import { startHermesSync } from './src/hermesSync.js';
import { registerRoutes } from './src/routes.js';
import { attachWs } from './src/ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, 'public');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);

const state = createState();

const app = Fastify({
  logger: {
    level: 'info',
  },
});

await app.register(cors, { origin: true });
await app.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
});

registerRoutes(app, { state });

// Pull real task/agent state from the hermes kanban CLI every 10s.
// Replaces the deterministic mockClock so the dashboard reflects actual
// board activity. Initial sync runs before the first HTTP bind so the
// first /api/state response already has data.
const hermesSync = startHermesSync(state, {
  intervalMs: 10_000,
  onError: (err) => app.log.warn({ err: err?.message ?? String(err) }, 'hermes sync failed; keeping last state'),
});

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`agent-arena backend up on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Attach WS once we have the underlying http server. Push interval dropped
// to 5s so clients see log entries appear in near real time.
attachWs(app.server, { state, intervalMs: 5000 });

// Don't block startup on the first sync; let the dashboard render whatever
// state already exists and update as soon as the CLI responds.
hermesSync.ready.catch((err) => app.log.warn({ err: err?.message ?? String(err) }, 'hermes sync failed at startup'));

process.on('SIGTERM', async () => { await app.close(); hermesSync.stop(); });
process.on('SIGINT', async () => { await app.close(); hermesSync.stop(); });
