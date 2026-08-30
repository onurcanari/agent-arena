// agent-arena backend entrypoint.
// Fastify v4 + CORS + static + JSON body + WS plugin.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createState } from './src/state.js';
import { tick } from './src/mockClock.js';
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

// Spin up mock mutations: deterministic, every 5 seconds.
const mockTimer = setInterval(() => tick(state), 5000);
if (typeof mockTimer.unref === 'function') mockTimer.unref();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`agent-arena backend up on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Attach WS once we have the underlying http server.
attachWs(app.server, { state, intervalMs: 5000 });
