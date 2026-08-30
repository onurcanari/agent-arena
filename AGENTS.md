# agent-arena

## Definition of Done
- `npm install` (production deps; --include=dev if you need a runner)
- `npm run lint` (syntax check on `server.js` only)
- `npm start` then verify:
  - `curl -sS http://localhost:3000/api/health` returns `{"ok":true}` (HTTP 200)
  - `curl -sS http://localhost:3000/api/state | python3 -m json.tool` returns 8 agents, 6 tasks, logs array
  - `curl -sS http://localhost:3000/` returns the `agent-arena backend up` HTML
  - within 30s, `/api/state` should gain >= 3 new log entries (mock clock ticks every 5s)
  - WebSocket: `ws://localhost:3000/ws` pushes `{type:"state", data:{...}}` frames every 5s

## Endpoints
- `GET  /api/health` -> `{ok:true}`
- `GET  /api/state`  -> `{agents[8], tasks[6], logs[]}`
- `GET  /api/logs?limit=N` (N clamped to 1..50) -> last N logs
- `POST /api/event` body `{type, agentId, taskId?, message}` -> appends log entry
- `WS   /ws`         -> full state every 5s

## Deploy
- Domain: https://loom.onurcanari.com (Dokploy, sunucu 140.245.6.201 - Traefik 80/443)
- Deploy komutu: project-deploy agent-arena
