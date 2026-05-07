// =============================================================
// Pomodoro Timer — Supernote Plugin
// Sidebar panel with 25-min work / 5-min break cycle.
// Uses the SupernoteAPI injected by the host via postMessage.
// =============================================================

/// <reference types="@supernote/plugin-sdk" />

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

// ------ State ------------------------------------------------

/** @type {"work" | "break"} */
let mode = "work";

/** Remaining seconds */
let remaining = WORK_SECONDS;

/** @type {ReturnType<typeof setInterval> | null} */
let ticker = null;

/** @type {boolean} */
let running = false;

// ------ DOM helpers ------------------------------------------

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} not found`);
  return node;
}

/** @param {number} secs @returns {string} */
function formatTime(secs) {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function render() {
  el("display").textContent = formatTime(remaining);
  el("mode-label").textContent = mode === "work" ? "Travail" : "Pause";
  el("btn-start").textContent = running ? "Pause" : "Demarrer";
  document.body.dataset.mode = mode;
}

// ------ Timer logic ------------------------------------------

/** @param {SupernoteAPI} api */
function tick(api) {
  if (remaining > 0) {
    remaining--;
    render();
    return;
  }

  // Session terminee
  clearInterval(ticker);
  ticker = null;
  running = false;

  if (mode === "work") {
    api.ui.showNotification({
      title: "Pomodoro termine !",
      body: "Session de 25 minutes ecoulee. Prenez une pause de 5 minutes.",
      level: "success",
    });
    mode = "break";
    remaining = BREAK_SECONDS;
  } else {
    api.ui.showNotification({
      title: "Pause terminee !",
      body: "Pret pour une nouvelle session de travail.",
      level: "info",
    });
    mode = "work";
    remaining = WORK_SECONDS;
  }

  render();
}

/** @param {SupernoteAPI} api */
function startPause(api) {
  if (running) {
    clearInterval(ticker);
    ticker = null;
    running = false;
  } else {
    running = true;
    ticker = setInterval(() => tick(api), 1000);
  }
  render();
}

function reset() {
  clearInterval(ticker);
  ticker = null;
  running = false;
  remaining = mode === "work" ? WORK_SECONDS : BREAK_SECONDS;
  render();
}

function switchMode() {
  clearInterval(ticker);
  ticker = null;
  running = false;
  mode = mode === "work" ? "break" : "work";
  remaining = mode === "work" ? WORK_SECONDS : BREAK_SECONDS;
  render();
}

// ------ Bootstrap --------------------------------------------

/**
 * Entry point called by the Supernote host after the handshake.
 * @param {SupernoteAPI} api
 */
function activate(api) {
  // Register "Reset Pomodoro" command accessible from command palette
  api.ui.registerCommand({
    id: "pomodoro.reset",
    label: "Pomodoro : Reinitialiser le timer",
    description: "Reinitialise le timer Pomodoro a sa valeur initiale",
  });

  // Build panel HTML (runs inside isolated iframe)
  document.body.innerHTML = `
    <div class="pomodoro-panel">
      <div class="mode-label" id="mode-label">Travail</div>
      <div class="display" id="display">25:00</div>
      <div class="controls">
        <button id="btn-start" class="btn btn-primary">Demarrer</button>
        <button id="btn-reset" class="btn btn-secondary">Reset</button>
        <button id="btn-switch" class="btn btn-secondary">Changer de mode</button>
      </div>
    </div>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: var(--bg, #fff); color: var(--fg, #111); }
      body[data-mode="break"] .mode-label { color: #16a34a; }
      body[data-mode="work"]  .mode-label { color: #dc2626; }
      .pomodoro-panel { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 16px; }
      .mode-label { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
      .display { font-size: 3.5rem; font-variant-numeric: tabular-nums; font-weight: 700; letter-spacing: -0.02em; }
      .controls { display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: opacity 0.15s; }
      .btn:hover { opacity: 0.85; }
      .btn-primary { background: #2563eb; color: #fff; }
      .btn-secondary { background: #e5e7eb; color: #374151; }
    </style>
  `;

  render();

  el("btn-start").addEventListener("click", () => startPause(api));
  el("btn-reset").addEventListener("click", () => reset());
  el("btn-switch").addEventListener("click", () => switchMode());
}

// Expose entry point for the host runtime
if (typeof module !== "undefined") {
  module.exports = { activate };
} else {
  window.activate = activate;
}
