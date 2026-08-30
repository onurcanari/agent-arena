// MockClock is disabled. Real state comes from src/hermesSync.js, which
// pulls from `hermes kanban list --json` on a 10s timer.
//
// This file is kept as a historical artifact of the initial mock-driven
// implementation. Do NOT import it — server.js wires real state now and
// the WS / REST endpoints should always reflect the hermes board data.

export function tick() {
  throw new Error('mockClock disabled — use src/hermesSync.js for real state');
}

export function maybeClaim() { throw new Error('mockClock disabled'); }
export function maybeProgress() { throw new Error('mockClock disabled'); }
export function maybeMerge() { throw new Error('mockClock disabled'); }
export function maybeError() { throw new Error('mockClock disabled'); }
