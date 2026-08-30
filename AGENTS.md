# agent-arena

## Definition of Done
- `npm install --include=dev` (ensure devDependencies like `ws` are present)
- `npm run lint` (syntax check on `server.js` only)
- `npm start` then verify:
  - `curl -sS http://localhost:3000/api/health` returns `{"ok":true}` (HTTP 200)
  - `curl -sS http://localhost:3000/api/state | python3 -m json.tool` returns 8 agents, 6 tasks, logs array
  - `curl -sS http://localhost:3000/` returns the `agent-arena backend up` HTML
  - within 30s, `/api/state` should gain >= 3 new log entries (real board sync every 10s)
  - WebSocket: `ws://localhost:3000/ws` pushes `{type:"state", data:{...}}` frames every 5s

## Architecture

- **Real board sync**: `src/hermesSync.js` pulls live state from `hermes kanban list --json` every 10 seconds and maps it onto the 8-agent visual scene. The first agent slot reflects the most recently active board assignee; remaining slots stay idle. If `HERMES_BIN` is not set, defaults to `/opt/hermes/bin/hermes` (override via env in CI/dev where hermes lives elsewhere). If the CLI is missing or returns malformed JSON, the sync pushes an `error` log entry and keeps the last good state; the server does not crash.
- **REST endpoints**: `/api/health`, `/api/state`, `/api/logs?limit=N`, `/POST /api/event`
- **WebSocket**: `/ws` broadcasts full state every 5 seconds

## Deploy
- Domain: https://loom.onurcanari.com (Dokploy, sunucu 140.245.6.201 - Traefik 80/443)
- Deploy komutu: project-deploy agent-arena
