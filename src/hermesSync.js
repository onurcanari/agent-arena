// Pulls real state from the hermes kanban CLI on a timer.
// Replaces the deterministic mockClock.js with data from real board tasks.
//
// Source of truth: `hermes kanban list --json` (one row per task, across every
// board, with status/assignee/timestamps). We aggregate that into the
// dashboard's existing shape (8 agent slots, 6 task slots, log feed) so the
// public REST + WS endpoints can stay the same.
//
// Mapping:
//   - Real board assignees are mapped onto the existing 8 kenney visual
//     slots (in order of most recent activity). Unused slots stay idle.
//   - Tasks come from the most recent 6 board tasks (any status).
//   - Log entries are derived from status transitions observed between syncs:
//     a row going to `running` logs a `claim`, a row going to `done` logs a
//     `merge`. Initial sync and unknown transitions log `info` so the feed
//     is never empty.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const TASK_LIMIT = 6;
const LOG_LIMIT = 50;
const HERMES_BIN = process.env.HERMES_BIN ?? '/opt/hermes/bin/hermes';
// Optional: path to a board.json file exported by the Hermes container
// (cron + loom-board-export.py). When set, the sync reads this file instead
// of spawning the hermes CLI (the CLI is unavailable inside the Dokploy
// container). File content: JSON array of `hermes kanban list --json` rows.
const HERMES_BOARD_FILE = process.env.HERMES_BOARD_FILE ?? '';
const SYNC_TIMEOUT_MS = 8000;

function statusToTaskStatus(kanbanStatus) {
  if (kanbanStatus === 'running') return 'working';
  if (kanbanStatus === 'done') return 'merged';
  return 'idle';
}

function statusToLogType(prev, next) {
  if (prev !== 'working' && next === 'working') return 'claim';
  if (prev !== 'merged' && next === 'merged') return 'merge';
  return 'info';
}

// Build a name from a board task. Title can be long; keep first 60 chars.
function shortTitle(title) {
  if (!title) return 'untitled task';
  if (title.length <= 60) return title;
  return `${title.slice(0, 57)}...`;
}

function pushLog(state, entry) {
  state.logs.push({
    id: state.nextLogId++,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (state.logs.length > LOG_LIMIT) {
    state.logs.shift();
  }
}

function taskDefForBoardTask(boardTask) {
  return {
    id: boardTask.id,
    title: shortTitle(boardTask.title),
    status: statusToTaskStatus(boardTask.status),
    owner: null,
    startedAt: boardTask.started_at
      ? new Date(boardTask.started_at * 1000).toISOString()
      : null,
    mergedAt: boardTask.completed_at
      ? new Date(boardTask.completed_at * 1000).toISOString()
      : null,
  };
}

// Fetch every task row across every board. Two sources:
//   1. HERMES_BOARD_FILE set -> read the exported board.json (Dokploy mode).
//   2. Otherwise spawn the hermes CLI (local dev mode).
// Returns an array of board-task objects (see kanban list --json shape).
// Logs a one-time info message on first failure (e.g. binary missing or file
// not mounted) and silently returns [] on subsequent ticks so the log feed
// doesn't get spammed every 10s.
let _hermesUnavailableWarned = false;
function warnOnce(state, message) {
  if (_hermesUnavailableWarned) return;
  pushLog(state, { type: 'info', message });
  _hermesUnavailableWarned = true;
}

async function fetchBoardTasks(state) {
  // --- Dokploy mode: read the exported board file ---
  if (HERMES_BOARD_FILE) {
    let raw;
    try {
      raw = await readFile(HERMES_BOARD_FILE, 'utf8');
      _hermesUnavailableWarned = false;
    } catch (err) {
      warnOnce(
        state,
        `board file not readable at ${HERMES_BOARD_FILE} (running in mock mode)`
      );
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Expected JSON array in board file');
      }
      return parsed;
    } catch (err) {
      state.logs.push({
        id: state.nextLogId++,
        timestamp: new Date().toISOString(),
        type: 'error',
        message: `Failed to parse board file: ${err.message}`,
      });
      return [];
    }
  }

  // --- Local dev mode: spawn the hermes CLI ---
  let stdout;
  try {
    const { stdout: out } = await execFileP(HERMES_BIN, ['kanban', 'list', '--json'], {
      timeout: SYNC_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = out;
    _hermesUnavailableWarned = false;
  } catch (err) {
    const msg = err?.code === 'ENOENT'
      ? `hermes CLI not found at ${HERMES_BIN} (running in mock mode)`
      : `hermes CLI failed: ${err?.message ?? String(err)}`;
    warnOnce(state, msg);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected array from hermes CLI');
    }
  } catch (err) {
    state.logs.push({
      id: state.nextLogId++,
      timestamp: new Date().toISOString(),
      type: 'error',
      message: `Failed to parse hermes JSON: ${err.message}`,
    });
    return [];
  }

  return parsed;
}

// Build the dashboard shape from a fresh board-task snapshot.
// Mutates `state` in place: replaces agents/tasks.
//
// Agent strategy: keep the 8 kenney-character visual slots from the initial
// state (positions are stable for the 3D scene). Map real board assignees
// onto the first N slots in deterministic order so the working state of
// each real agent shows up in the same character on every refresh.
function applyBoardSnapshot(state, boardTasks) {
  // Group by assignee, then sort assignees by most-recent activity so
  // the first slot always shows the most recently active profile.
  const byAssignee = new Map();
  for (const t of boardTasks) {
    const slug = t.assignee ?? 'unknown';
    if (!byAssignee.has(slug)) byAssignee.set(slug, []);
    byAssignee.get(slug).push(t);
  }
  const orderedSlugs = [...byAssignee.entries()]
    .sort((a, b) => {
      const aMax = Math.max(...a[1].map((t) => t.started_at ?? t.created_at ?? 0));
      const bMax = Math.max(...b[1].map((t) => t.started_at ?? t.created_at ?? 0));
      return bMax - aMax;
    })
    .map(([slug]) => slug)
    .slice(0, state.agents.length);

  // Most recent N tasks for the task board (any status).
  const sortedTasks = [...boardTasks].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  const taskSlice = sortedTasks.slice(0, TASK_LIMIT);

  // Diff against previous state for transition logs.
  const prevTaskById = new Map(state.tasks.map((t) => [t.id, t]));

  // Update existing agent slots in place so positions stay stable.
  const newAgents = state.agents.map((agent, i) => {
    const slug = orderedSlugs[i] ?? null;
    if (!slug) {
      return { ...agent, status: 'idle', currentTask: null };
    }
    const ownerTasks = byAssignee.get(slug) ?? [];
    const running = ownerTasks.find((t) => t.status === 'running');
    return {
      ...agent,
      // Preserve the kenney visual name for the 3D scene; working state
      // and current task reflect the real board assignee mapped to this slot.
      status: running ? 'working' : 'idle',
      currentTask: running ? running.id : null,
    };
  });

  // Build new tasks and emit transition logs.
  const newTasks = taskSlice.map((bt) => {
    const def = taskDefForBoardTask(bt);
    if (bt.assignee) {
      def.owner = `agent-${bt.assignee}`;
    }
    const prev = prevTaskById.get(bt.id);
    if (!prev) {
      pushLog(state, {
        type: 'info',
        agentId: def.owner,
        taskId: def.id,
        message: `synced ${bt.status} task from hermes: ${def.title}`,
      });
    } else if (prev.status !== def.status) {
      pushLog(state, {
        type: statusToLogType(prev.status, def.status),
        agentId: def.owner,
        taskId: def.id,
        message: `${bt.assignee ?? 'unknown'}: ${prev.status} -> ${def.status} (${def.title})`,
      });
    }
    return def;
  });

  state.agents = newAgents;
  state.tasks = newTasks;
}

// Single sync tick: fetch + apply. Resolves with the new agent/task count
// for heartbeat logging, or rejects on transient error.
export async function syncFromHermes(state) {
  const boardTasks = await fetchBoardTasks(state);
  applyBoardSnapshot(state, boardTasks);
  return {
    agents: state.agents.length,
    tasks: state.tasks.length,
    logs: state.logs.length,
    source: boardTasks.length,
  };
}

// Start the periodic sync. Returns a stop() function and a Promise that
// resolves after the first successful sync (so callers can wait for initial
// data before binding the HTTP/WS layer).
export function startHermesSync(state, { intervalMs = 10000, onError } = {}) {
  let stopped = false;
  let timer = null;

  const firstSync = (async () => {
    try {
      await syncFromHermes(state);
    } catch (err) {
      if (onError) onError(err);
    }
  })();

  const tick = async () => {
    if (stopped) return;
    try {
      await syncFromHermes(state);
    } catch (err) {
      if (onError) onError(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    ready: firstSync,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
