// Deterministic mock clock that mutates state every 5 seconds.
// Keeps logs capped at 50 entries.

const LOG_LIMIT = 50;

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

function maybeClaim(state) {
  const agent = state.agents.find((a) => a.status === 'idle');
  const task = state.tasks.find((t) => t.status === 'idle');
  if (!agent || !task) return false;

  agent.status = 'working';
  agent.currentTask = task.id;
  task.status = 'working';
  task.owner = agent.id;
  task.startedAt = new Date().toISOString();

  pushLog(state, {
    type: 'claim',
    agentId: agent.id,
    taskId: task.id,
    message: `${agent.name} started ${task.title}`,
  });
  return true;
}

function maybeProgress(state) {
  const working = state.tasks.filter((t) => t.status === 'working');
  if (working.length === 0) return false;
  const task = working[Math.floor(Math.random() * working.length)];
  const agent = state.agents.find((a) => a.id === task.owner);

  pushLog(state, {
    type: 'progress',
    agentId: agent?.id ?? null,
    taskId: task.id,
    message: `${agent?.name ?? '?'}: progress on ${task.title}`,
  });
  return true;
}

function maybeMerge(state) {
  const working = state.tasks.filter((t) => t.status === 'working');
  if (working.length === 0) return false;
  const task = working[Math.floor(Math.random() * working.length)];
  const agent = state.agents.find((a) => a.id === task.owner);

  task.status = 'merged';
  task.mergedAt = new Date().toISOString();
  if (agent) {
    agent.status = 'idle';
    agent.currentTask = null;
  }

  pushLog(state, {
    type: 'merge',
    agentId: agent?.id ?? null,
    taskId: task.id,
    message: `${agent?.name ?? '?'}: merged ${task.title}`,
  });
  return true;
}

function maybeError(state) {
  const agents = state.agents.filter((a) => a.status === 'working');
  if (agents.length === 0) return false;
  const agent = agents[Math.floor(Math.random() * agents.length)];
  const task = state.tasks.find((t) => t.id === agent.currentTask);

  pushLog(state, {
    type: 'error',
    agentId: agent.id,
    taskId: task?.id ?? null,
    message: `${agent.name}: encountered an error while working on ${task?.title ?? 'unknown task'}`,
  });
  return true;
}

const actions = [maybeClaim, maybeProgress, maybeMerge, maybeError];

export function tick(state) {
  // Run one action per 5s tick. If a category has nothing to act on
  // (e.g. all tasks merged), try the next category so we still emit logs.
  for (let i = 0; i < actions.length; i++) {
    const action = actions[(i + Math.floor(Math.random() * actions.length)) % actions.length];
    if (action(state)) return state;
  }
  return state;
}
