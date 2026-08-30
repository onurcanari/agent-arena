// Agent Arena — three.js 3D scene with task board + log feed overlay
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// ---------- Constants ----------
const AGENT_COUNT = 8;
const TASK_COUNT = 6;
const WS_RECONNECT_MS = 2000;
const MAX_LOG_ENTRIES = 50;
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const LABEL_HEIGHT_OFFSET = 1.4;

const STATE = {
  agents: [],
  tasks: [],
  logs: [],
};

// ---------- Three.js setup ----------
const canvas = document.getElementById('arena');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.fog = new THREE.Fog(0x1a1a1a, 12, 25);

// 25 degrees from above looking down — camera positioned high & back
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
const cameraHome = new THREE.Vector3(0, 6.5, 9);
const cameraTarget = new THREE.Vector3(0, 0.8, 0);
camera.position.copy(cameraHome);
camera.lookAt(cameraTarget);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(cameraTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minPolarAngle = 0.6;
controls.maxPolarAngle = 1.4;
controls.minDistance = 5;
controls.maxDistance = 18;
controls.update();

// ---------- Lighting ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(4, 8, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 1024;
keyLight.shadow.mapSize.height = 1024;
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 20;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x6a8cff, 0.4);
fillLight.position.set(-5, 4, -3);
scene.add(fillLight);

// ---------- Ground ----------
const groundGeo = new THREE.PlaneGeometry(10, 10);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x2d3a26,
  roughness: 0.95,
  metalness: 0.0,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Scene furniture: desks, monitors ----------
const deskMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1f, roughness: 0.85 });
const deskTopGeo = new THREE.BoxGeometry(0.9, 0.06, 0.6);
const deskLegGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
const monitorFrameGeo = new THREE.BoxGeometry(0.5, 0.32, 0.04);
const monitorStandGeo = new THREE.BoxGeometry(0.06, 0.18, 0.06);
const monitorScreenGeo = new THREE.BoxGeometry(0.42, 0.26, 0.02);
const monitorScreenMat = new THREE.MeshStandardMaterial({
  color: 0x4a9eff,
  emissive: 0x2a5eff,
  emissiveIntensity: 0.9,
  roughness: 0.3,
});

// ---------- Character placement ----------
// Two rows arc, back-to-front, slightly fanned out
function getAgentPosition(i) {
  const row = Math.floor(i / 4); // 0 = back, 1 = front
  const col = i % 4;
  const angle = (col - 1.5) * 0.35; // fan angle across row
  const zBase = row === 0 ? -1.6 : 1.6;
  const x = Math.sin(angle) * 1.6;
  const z = zBase + (row === 0 ? -Math.cos(angle) * 0.6 : Math.cos(angle) * 0.6);
  return { x, z, angle };
}

// ---------- Character meshes ----------
const characters = [];
const agentPositions = [];

const loader = new GLTFLoader();
const modelSources = [
  '/assets/kenney/character-male-c.glb',
  '/assets/kenney/character-female-c.glb',
];

const models = [];
let modelsLoaded = 0;
let modelsFailed = false;

function loadCharacterModels() {
  const loadPromises = modelSources.map((url) => new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        models.push(gltf.scene);
        resolve();
      },
      undefined,
      () => {
        // Graceful fallback marker
        models.push(null);
        resolve();
      }
    );
  }));
  return Promise.all(loadPromises);
}

function createPlaceholderCharacter() {
  // Simple humanoid placeholder: body + head + arms
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9a7b3f, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.22), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), bodyMat);
  head.position.y = 0.97;
  head.castShadow = true;
  group.add(head);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), bodyMat);
  leftArm.position.set(-0.22, 0.55, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), bodyMat);
  rightArm.position.set(0.22, 0.55, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  group.userData.placeholder = true;
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  return group;
}

function buildScene() {
  for (let i = 0; i < AGENT_COUNT; i++) {
    const pos = getAgentPosition(i);
    agentPositions.push(pos);

    const sourceIdx = i % models.length;
    const modelTemplate = models[sourceIdx];

    let character;
    if (modelTemplate) {
      character = modelTemplate.clone(true);
      character.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      character.userData.placeholder = false;
      // Scale Kenney characters to a sensible size; they tend to be ~1m tall
      character.scale.set(0.55, 0.55, 0.55);
    } else {
      character = createPlaceholderCharacter();
    }

    character.position.set(pos.x, 0, pos.z);
    character.rotation.y = pos.angle + Math.PI; // face the table (origin)
    scene.add(character);
    characters.push(character);

    // Build desk + monitor in front of character
    const desk = new THREE.Group();
    const deskTop = new THREE.Mesh(deskTopGeo, deskMat);
    deskTop.position.y = 0.73;
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    desk.add(deskTop);

    const legPositions = [
      [-0.4, 0, -0.25], [0.4, 0, -0.25],
      [-0.4, 0, 0.25], [0.4, 0, 0.25],
    ];
    legPositions.forEach(([x, _y, z]) => {
      const leg = new THREE.Mesh(deskLegGeo, deskMat);
      leg.position.set(x, 0.35, z);
      leg.castShadow = true;
      desk.add(leg);
    });

    // Monitor facing the character (away from origin)
    const monitorGroup = new THREE.Group();
    const frame = new THREE.Mesh(monitorFrameGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    frame.castShadow = true;
    monitorGroup.add(frame);
    const screen = new THREE.Mesh(monitorScreenGeo, monitorScreenMat);
    screen.position.z = 0.025;
    monitorGroup.add(screen);
    const stand = new THREE.Mesh(monitorStandGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    stand.position.y = -0.25;
    monitorGroup.add(stand);

    // Place monitor on desk, oriented toward character
    monitorGroup.position.set(0, 1.0, 0);
    // Monitor faces character (i.e. away from origin in row's direction)
    const facing = new THREE.Vector3(pos.x, 1.0, pos.z).normalize();
    monitorGroup.lookAt(pos.x * 2, 1.0, pos.z * 2);
    desk.add(monitorGroup);

    // Desk positioned between character and origin
    const deskX = pos.x * 0.55;
    const deskZ = pos.z * 0.55;
    desk.position.set(deskX, 0, deskZ);
    desk.lookAt(pos.x, 0, pos.z);
    scene.add(desk);

    // HTML label
    const label = document.createElement('div');
    label.className = 'character-label';
    label.innerHTML = `<span class="name">${agent.name}</span><span class="badge idle">IDLE</span>`;
    document.body.appendChild(label);
    character.userData.label = label;
    character.userData.status = 'idle';
  }
}

// ---------- Label projection ----------
function updateLabels() {
  const v = new THREE.Vector3();
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const label = c.userData.label;
    if (!label) continue;
    v.set(c.position.x, c.position.y + LABEL_HEIGHT_OFFSET, c.position.z);
    v.project(camera);
    if (v.z > 1 || v.z < -1) {
      label.style.display = 'none';
      continue;
    }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    label.style.display = 'block';
  }
}

// ---------- Animation ----------
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();

  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const status = c.userData.status;
    if (status === 'working') {
      // Typing: arms forward-back at 0.5Hz, ±0.2 rad
      if (c.userData.placeholder) {
        const arm = Math.sin(t * Math.PI) * 0.2;
        c.userData.leftArm.rotation.x = -arm;
        c.userData.rightArm.rotation.x = arm;
      } else {
        // For real GLB models, gentle body sway + small forward lean
        c.rotation.z = Math.sin(t * Math.PI) * 0.04;
      }
    } else {
      // idle: sin(time)*0.05 Y rotation
      c.rotation.y = c.userData.baseRotationY + Math.sin(t * 0.6 + i) * 0.05;
      if (!c.userData.placeholder) c.rotation.z = 0;
    }
  }

  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---------- Camera tween (1 second smooth pan) ----------
let cameraTween = null;
function tweenCamera(targetPos, targetLook, duration = 1000) {
  const startPos = camera.position.clone();
  const startLook = controls.target.clone();
  const startTime = performance.now();
  cameraTween = { startPos, startLook, targetPos, targetLook, startTime, duration };
}

function updateCameraTween(now) {
  if (!cameraTween) return;
  const elapsed = now - cameraTween.startTime;
  const t = Math.min(elapsed / cameraTween.duration, 1);
  // Ease in-out cubic
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  camera.position.lerpVectors(cameraTween.startPos, cameraTween.targetPos, eased);
  controls.target.lerpVectors(cameraTween.startLook, cameraTween.targetLook, eased);
  if (t >= 1) cameraTween = null;
}

// Wrap in a single rAF loop
function loop() {
  const now = performance.now();
  updateCameraTween(now);
  animate();
  requestAnimationFrame(loop);
}

// ---------- UI updates ----------
const STATUS_COLOR = {
  idle: '#555',
  working: '#d4a017',
  merged: '#2d8a3e',
  error: '#b03030',
};
const STATUS_LABEL = {
  idle: 'IDLE',
  working: 'WORKING',
  merged: 'MERGED',
  error: 'ERROR',
};

function renderTaskBoard() {
  const boxes = document.querySelectorAll('.task-box');
  boxes.forEach((box, idx) => {
    const task = STATE.tasks[idx];
    const status = task?.status || 'idle';
    const idText = task?.id || `T-${idx}`;
    const idEl = box.querySelector('.task-id');
    const statusEl = box.querySelector('.task-status');
    if (idEl) idEl.textContent = idText;
    if (statusEl) {
      statusEl.className = `task-status ${status}`;
      statusEl.textContent = STATUS_LABEL[status] || status.toUpperCase();
    }
  });
}

function renderLogFeed() {
  const list = document.getElementById('log-list');
  if (!list) return;
  const wasAtTop = list.scrollTop === 0;
  list.innerHTML = '';
  STATE.logs.slice(0, MAX_LOG_ENTRIES).forEach((entry) => {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.type || 'info'}`;
    const ts = new Date(entry.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span class="ts">${ts}</span><span class="type">${entry.type || 'info'}</span><span class="msg">${escapeHtml(entry.message || '')}</span>`;
    list.appendChild(div);
  });
  if (wasAtTop) list.scrollTop = 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyAgentState() {
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const agent = STATE.agents[i];
    if (!agent) continue;
    const newStatus = agent.status || 'idle';
    if (c.userData.status !== newStatus) {
      c.userData.status = newStatus;
      const label = c.userData.label;
      if (label) {
        const badge = label.querySelector('.badge');
        if (badge) {
          badge.className = `badge ${newStatus}`;
          badge.textContent = STATUS_LABEL[newStatus] || newStatus.toUpperCase();
        }
      }
    }
    if (typeof agent.position?.x === 'number' && typeof agent.position?.z === 'number') {
      c.position.x = agent.position.x;
      c.position.z = agent.position.z;
    }
    if (!c.userData.baseRotationY) {
      c.userData.baseRotationY = c.rotation.y;
    }
  }
}

// ---------- WebSocket state stream ----------
let ws = null;
function connectWs() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (_e) {
    setTimeout(connectWs, WS_RECONNECT_MS);
    return;
  }
  ws.addEventListener('open', () => {
    console.log('ws connected');
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_e) { return; }
    if (!msg || msg.type !== 'state' || !msg.data) return;
    const data = msg.data;
    if (Array.isArray(data.agents)) STATE.agents = data.agents;
    if (Array.isArray(data.tasks)) STATE.tasks = data.tasks;
    if (Array.isArray(data.logs)) {
      const existing = new Set(STATE.logs.map((l) => (l.ts || 0) + '|' + (l.msg || '')));
      const fresh = data.logs.filter((l) => !existing.has((l.ts || 0) + '|' + (l.msg || '')));
      STATE.logs = [...fresh, ...STATE.logs].slice(0, MAX_LOG_ENTRIES);
    }
    applyAgentState();
    renderTaskBoard();
    renderLogFeed();
  });
  ws.addEventListener('close', () => {
    setTimeout(connectWs, WS_RECONNECT_MS);
  });
}

// ---------- WebGL error handling ----------
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const overlay = document.createElement('div');
  overlay.className = 'webgl-error';
  overlay.innerHTML = '<h2>WebGL Context Lost</h2><p>The 3D renderer lost its context. Please reload the page to restore the arena.</p>';
  document.body.appendChild(overlay);
});

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Task board click → camera pan ----------
document.querySelectorAll('.task-box').forEach((box) => {
  box.addEventListener('click', () => {
    const idx = parseInt(box.dataset.index || '0', 10);
    const targetAgent = characters[idx];
    if (!targetAgent) return;
    const dest = new THREE.Vector3(
      targetAgent.position.x,
      2.0,
      targetAgent.position.z + 2.5
    );
    const look = new THREE.Vector3(targetAgent.position.x, 0.8, targetAgent.position.z);
    tweenCamera(dest, look, 1000);
  });
});

// ---------- Bootstrap ----------
async function init() {
  // Always set up placeholder geometry so the scene renders even if models fail
  buildScene();
  // Stash base rotation
  for (const c of characters) c.userData.baseRotationY = c.rotation.y;

  // Load real models in background; if they arrive, swap in
  loadCharacterModels().then(() => {
    if (models.every((m) => m === null)) return; // all failed, keep placeholders
    // Rebuild with real models if any loaded
    for (let i = 0; i < characters.length; i++) {
      const sourceIdx = i % models.length;
      const modelTemplate = models[sourceIdx];
      if (!modelTemplate) continue;
      const pos = agentPositions[i];
      const newChar = modelTemplate.clone(true);
      newChar.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      newChar.scale.set(0.55, 0.55, 0.55);
      newChar.position.copy(characters[i].position);
      newChar.rotation.copy(characters[i].rotation);
      newChar.userData.label = characters[i].userData.label;
      newChar.userData.status = characters[i].userData.status;
      newChar.userData.baseRotationY = characters[i].rotation.y;
      newChar.userData.placeholder = false;
      scene.add(newChar);
      scene.remove(characters[i]);
      characters[i] = newChar;
    }
  });

  loop();
  connectWs();
}

init();