// HTTP routes for the agent-arena backend.

import { snapshot } from './state.js';

export function registerRoutes(app, { state }) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async () => snapshot(state));

  app.get('/api/logs', async (req) => {
    const limit = Math.max(
      1,
      Math.min(50, Number.parseInt(req.query?.limit ?? '20', 10) || 20),
    );
    const all = state.logs;
    return all.slice(Math.max(0, all.length - limit));
  });

  app.post('/api/event', async (req, reply) => {
    const body = req.body ?? {};
    const type = typeof body.type === 'string' ? body.type : null;
    const agentId = typeof body.agentId === 'string' ? body.agentId : null;
    const taskId = typeof body.taskId === 'string' ? body.taskId : null;
    const message = typeof body.message === 'string' ? body.message : '';

    if (!type) {
      reply.code(400);
      return { error: 'type is required' };
    }
    if (!agentId) {
      reply.code(400);
      return { error: 'agentId is required' };
    }

    const allowed = new Set(['info', 'claim', 'progress', 'merge', 'error']);
    if (!allowed.has(type)) {
      reply.code(400);
      return { error: `type must be one of: ${[...allowed].join(', ')}` };
    }

    const entry = {
      id: state.nextLogId++,
      type,
      agentId,
      taskId,
      message: message || `${agentId} emitted ${type}`,
      timestamp: new Date().toISOString(),
    };
    state.logs.push(entry);
    if (state.logs.length > 50) state.logs.shift();

    return { ok: true, log: entry };
  });
}
