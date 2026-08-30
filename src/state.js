// In-memory state for agent-arena backend.
// 8 kenney-style "coder" agents, 6 task slots, and a rolling log buffer.

const AGENT_DEFS = [
  { slug: 'kenney',       name: 'Kenney' },
  { slug: 'rogue',        name: 'Rogue' },
  { slug: 'minifig',      name: 'Minifig' },
  { slug: 'robot',        name: 'Robot' },
  { slug: 'astronaut',    name: 'Astronaut' },
  { slug: 'ninja',        name: 'Ninja' },
  { slug: 'pirate',       name: 'Pirate' },
  { slug: 'knight',       name: 'Knight' },
];

const TASK_TITLES = [
  'Bootstrap dashboard',
  'Wire WS protocol',
  'Mock agent activity',
  'Render three.js scene',
  'Persist state snapshot',
  'Hook kanban events',
];

function createAgents() {
  return AGENT_DEFS.map((def, i) => {
    // Spread agents around a small grid so the 3D scene can place them later.
    const col = i % 4;
    const row = Math.floor(i / 4);
    return {
      id: `agent-${def.slug}`,
      slug: def.slug,
      name: def.name,
      role: 'coder',
      status: 'idle',
      currentTask: null,
      position: { x: col * 2, z: row * 2 },
    };
  });
}

function createTasks() {
  return TASK_TITLES.map((title, i) => ({
    id: `task-${String(i + 1).padStart(2, '0')}`,
    title,
    status: 'idle',
    owner: null,
    startedAt: null,
    mergedAt: null,
  }));
}

export function createState() {
  return {
    agents: createAgents(),
    tasks: createTasks(),
    logs: [],
    nextLogId: 1,
  };
}

export function snapshot(state) {
  return {
    agents: state.agents.map((a) => ({ ...a, position: { ...a.position } })),
    tasks: state.tasks.map((t) => ({ ...t })),
    logs: state.logs.map((l) => ({ ...l })),
  };
}
