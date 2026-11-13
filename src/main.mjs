// The page: screens, input, the frame loop, and the AI driver (search in a Web Worker).
import { Game, LEFT, RIGHT, SOFT, HARD, RCW, RCCW, HOLD } from "./game.mjs";
import { HighLevelAIGame, HIGH_LEVEL_ACTIONS } from "./ai.mjs";
import { View, hueForLevel } from "./view.mjs";
import * as audio from "./audio.mjs";
import { setupAbout } from "./about.mjs";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- state ----------
const S = {
  screen: "menu",           // menu | play | paused | over
  driver: "human",          // human | ai
  game: null,
  fps: 60,                  // game frames per second
  depth: 1,                 // AI lookahead: 0 = this piece, 1 = this piece and the next
  queue: [],                // AI: frames of inputs still to play
  pending: null,            // AI: id of the request the worker is working on
  reqId: 0,
  acc: 0,
  attract: false,           // the AI game playing behind the start screen
  everHuman: false,         // did a person play any of this game (for the best score)
  aiStats: { pieces: 0, ms: 0 },
};

const view = new View($("board"), $("glow"));
let worker = null;

function startWorker() {
  worker = new Worker(new URL("./ai-worker.mjs", import.meta.url), { type: "module" });
  worker.onmessage = (e) => onAIReply(e.data);
}

// ---------- games ----------
function newGame(seed) {
  const g = new Game({ seed: seed ?? (params.has("seed") ? Number(params.get("seed")) : undefined) });
  g.listener = onGameEvent;
  S.game = g;
  S.queue = [];
  S.pending = null;
  S.acc = 0;
  S.deadAt = 0;
  S.everHuman = false;
  view.setGame(g);
  document.body.style.setProperty("--well-hue", Math.round(hueForLevel(g.level)));
  return g;
}

function onGameEvent(name, data, game) {
  if (game !== S.game) return;
  view.event(name, data);
  if (S.attract) return; // the start screen's game is silent
  if (name === "lock") {
    if (data.clears === 0) audio.play("lock");
  } else if (name === "hardDrop") audio.play("hardDrop");
  else if (name === "clear") audio.play("clear", data);
  else if (name === "tetris") audio.play("tetris");
  else if (name === "levelUp") {
    audio.play("levelUp");
    document.body.style.setProperty("--well-hue", Math.round(hueForLevel(data)));
  } else if (name === "death") audio.play("death");
  else if (name === "rotate") audio.play("rotate");
  else if (name === "shift" && S.driver === "human") audio.play("shift");
  else if (name === "hold") audio.play("hold");
}

// ---------- input ----------
const KEYMAP = {
  ArrowLeft: LEFT, ArrowRight: RIGHT, ArrowDown: SOFT, Space: HARD,
  KeyZ: RCCW, KeyX: RCW, ArrowUp: RCW, ShiftLeft: HOLD, ShiftRight: HOLD, KeyC: HOLD,
};
const held = new Map();     // input -> number of sources holding it (keys, touch buttons)
const tapped = new Set();   // pressed since the last frame (so a tap shorter than a frame counts)

function press(input) { held.set(input, (held.get(input) || 0) + 1); tapped.add(input); }
function release(input) { const n = (held.get(input) || 0) - 1; if (n <= 0) held.delete(input); else held.set(input, n); }
function releaseAll() { held.clear(); tapped.clear(); }
function inputsThisFrame() {
  const out = new Set(tapped);
  for (const k of held.keys()) out.add(k);
  tapped.clear();
  return [...out];
}

const keysDown = new Set();
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector(".cohesion-modal-backdrop")) return;
  audio.unlockAudio();
  const input = KEYMAP[e.code];
  if (S.screen === "play" && input) {
    e.preventDefault();
    if (!keysDown.has(e.code)) { keysDown.add(e.code); press(input); }
    return;
  }
  if (e.repeat) return;
  if ((e.code === "Escape" || e.code === "KeyP") && (S.screen === "play" || S.screen === "paused")) { e.preventDefault(); togglePause(); }
  else if (e.code === "KeyA" && S.screen === "play") toggleAI();
  else if (e.code === "KeyM") toggleSound();
  else if (e.code === "Enter" && S.screen === "menu") startPlay("human");
  else if (e.code === "Enter" && S.screen === "over") startPlay("human");
});
addEventListener("keyup", (e) => {
  const input = KEYMAP[e.code];
  if (input && keysDown.has(e.code)) { keysDown.delete(e.code); release(input); }
});
addEventListener("blur", () => { keysDown.clear(); releaseAll(); });

// touch pad: each button holds its input while pressed (so DAS works as with keys)
for (const b of document.querySelectorAll("[data-input]")) {
  const input = b.dataset.input;
  let down = false;
  const up = () => { if (down) { down = false; b.classList.remove("is-down"); release(input); } };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio.unlockAudio();
    if (S.screen !== "play" || S.driver !== "human") return;
    b.setPointerCapture?.(e.pointerId);
    down = true; b.classList.add("is-down"); press(input);
  });
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("lostpointercapture", up);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---------- the AI driver ----------
// aiController.HighLevelController, one frame per call: skip the entry delay, ask for a move
// when out of inputs, then play one frame of the move's inputs. Returns false while waiting
// for the worker (the game doesn't advance, as the Python's loop blocked on chooseAction).
function aiFrame(game) {
  while (game.spawnRequired) game.update([]);
  if (S.queue.length === 0) {
    if (S.pending === null) requestMove(game);
    return false;
  }
  game.update(S.queue.shift());
  return true;
}

function requestMove(game) {
  const id = ++S.reqId;
  S.pending = id;
  S.pendingGame = game;
  worker.postMessage({ id, state: game.toJSON(), depth: S.attract ? 0 : S.depth });
}

function onAIReply(r) {
  if (r.id !== S.pending) return; // a stale answer (game changed or the human took over)
  S.pending = null;
  const game = S.pendingGame;
  if (game !== S.game) return;
  const action = HIGH_LEVEL_ACTIONS[r.index];
  S.queue = new HighLevelAIGame(game).generateInputs(action);
  S.aiStats.pieces++;
  S.aiStats.ms += r.ms;
  // the best few distinct landings, for the outlines
  const seen = new Map();
  r.values.forEach((v, i) => {
    const cells = r.landings[i];
    if (!cells) return;
    const key = cells.map((p) => `${p.x},${p.y}`).sort().join(" ");
    const prev = seen.get(key);
    if (!prev || v > prev.v || i === r.index) seen.set(key, { v: i === r.index ? Infinity : v, cells });
  });
  const top = [...seen.values()].sort((a, b) => b.v - a.v).slice(0, 6);
  view.setCandidates({ top, t0: performance.now() });
}

function setDriver(d) {
  S.driver = d;
  S.queue = [];
  S.pending = null; // ignore any answer in flight
  releaseAll();
  keysDown.clear();
  if (d === "human") S.everHuman = true;
  view.candidates = null;
  if (d === "human") setFps(60, false);
  syncChrome();
}

function toggleAI() {
  if (S.screen !== "play") return;
  setDriver(S.driver === "ai" ? "human" : "ai");
}

// ---------- speed (frames per second, log slider) ----------
const FPS_MIN = 6, FPS_MAX = 6000;
const sliderToFps = (v) => Math.round(FPS_MIN * Math.pow(FPS_MAX / FPS_MIN, v / 100));
const fpsToSlider = (f) => (100 * Math.log(f / FPS_MIN)) / Math.log(FPS_MAX / FPS_MIN);
function setFps(f, fromSlider) {
  S.fps = f;
  if (!fromSlider) $("speed").value = String(fpsToSlider(f));
  $("speedVal").textContent = `${f >= 1000 ? (f / 1000).toFixed(1) + "k" : f}/s`;
}
$("speed").addEventListener("input", (e) => setFps(sliderToFps(Number(e.target.value)), true));

// for tests only: the game sets the level (and so gravity) itself as lines are cleared
function setLevel(l) {
  const g = S.game;
  if (!g) return;
  l = Math.max(1, Math.min(99, l));
  g.level = l;
  g.linesThisLevel = 0;
  view.targetHue = hueForLevel(l);
  document.body.style.setProperty("--well-hue", Math.round(hueForLevel(l)));
  syncHUD(true);
}

function setDepth(d) {
  S.depth = d;
  for (const b of $("depthSeg").querySelectorAll("button")) b.classList.toggle("is-on", Number(b.dataset.depth) === d);
}
for (const b of $("depthSeg").querySelectorAll("button")) b.addEventListener("click", () => setDepth(Number(b.dataset.depth)));

// ---------- sound ----------
function toggleSound() {
  audio.setMuted(!audio.isMuted());
  audio.unlockAudio();
  $("soundIco").innerHTML = audio.isMuted()
    ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6M22 9l-6 6"/>'
    : '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
}
$("soundBtn").addEventListener("click", toggleSound);

// ---------- screens ----------
function startAttract() {
  S.attract = true;
  S.screen = "menu";
  S.driver = "ai";
  newGame(params.has("seed") ? Number(params.get("seed")) : undefined);
  setFps(60, false);
  syncChrome();
}

function startPlay(driver) {
  audio.unlockAudio();
  S.attract = false;
  S.screen = "play";
  newGame();
  setFps(60, false);
  setDriver(driver);
  if (driver === "human") S.everHuman = true;
  syncChrome();
}

function togglePause() {
  if (S.screen === "play") { S.screen = "paused"; releaseAll(); keysDown.clear(); }
  else if (S.screen === "paused") S.screen = "play";
  syncChrome();
}

function gameOver() {
  S.screen = "over";
  const g = S.game;
  $("overScore").textContent = g.score.toLocaleString();
  $("overLines").textContent = g.totalLinesCleared;
  $("overLevel").textContent = g.level;
  let sub = S.driver === "ai" ? "The AI topped out." : "The stack reached the top.";
  const best = readBest();
  $("overTitle").textContent = "Game over";
  if (S.everHuman && S.driver === "human" && g.score > best) {
    writeBest(g.score);
    sub = "New best score.";
  }
  $("overSub").textContent = sub;
  syncChrome();
}

function readBest() { try { return Number(localStorage.getItem("quasarbright:tetris-best")) || 0; } catch { return 0; } }
function writeBest(v) { try { localStorage.setItem("quasarbright:tetris-best", String(v)); } catch { /* private mode */ } }

$("playBtn").addEventListener("click", () => startPlay("human"));
$("watchBtn").addEventListener("click", () => startPlay("ai"));
$("pauseBtn").addEventListener("click", togglePause);
$("resumeBtn").addEventListener("click", togglePause);
$("restartBtn").addEventListener("click", () => startPlay(S.driver));
$("menuBtn").addEventListener("click", startAttract);
$("againBtn").addEventListener("click", () => startPlay("human"));
$("watchAgainBtn").addEventListener("click", () => startPlay("ai"));
$("overMenuBtn").addEventListener("click", startAttract);
$("aiBtn").addEventListener("click", toggleAI);
$("aiTopBtn").addEventListener("click", toggleAI);

const touchQuery = matchMedia("(pointer: coarse)");
const isPhone = () => innerWidth < 640;
const showPad = () => touchQuery.matches || isPhone();

function syncChrome() {
  const inGame = S.screen !== "menu";
  const ai = S.driver === "ai";
  $("menu").hidden = S.screen !== "menu";
  $("bar").hidden = !inGame;
  $("pauseCard").hidden = S.screen !== "paused";
  $("overCard").hidden = S.screen !== "over";
  const pad = showPad();
  // the dock: desktop always (AI button + keys or AI controls); phones only while the AI plays
  $("dock").hidden = !inGame || (pad && !ai);
  $("pad").hidden = !inGame || !pad || ai;
  $("keys").hidden = ai || pad;
  $("aiControls").hidden = !ai;
  $("aiTopBtn").hidden = !pad || ai;
  $("aiBadge").hidden = !(inGame && ai);
  $("aiBtn").classList.toggle("is-ai-on", ai);
  $("aiBtn").classList.toggle("is-cyan", !ai);
  $("aiBtnLabel").textContent = ai ? "Take over" : "Let the AI play";
  $("aiBtn").title = ai ? "take the game back from the AI (A)" : "hand the game to the AI (A)";
  const best = readBest();
  $("best").hidden = best <= 0;
  $("bestVal").textContent = best.toLocaleString();
  $("playSub").textContent = touchQuery.matches ? "on-screen buttons" : "arrows, space, Z/X, shift";
  syncHUD(true);
  relayout();
}

const hudCache = {};
function syncHUD(force) {
  const g = S.game;
  if (!g) return;
  const set = (id, v) => { if (force || hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } };
  set("score", g.score.toLocaleString());
  set("lines", String(g.totalLinesCleared));
  set("level", String(g.level));
}

// ---------- layout ----------
function relayout() {
  const W = innerWidth, H = innerHeight;
  let top = 12, bottom = H - 30;
  if (S.screen !== "menu") {
    const bar = $("bar").getBoundingClientRect();
    top = bar.bottom + 10;
    for (const id of ["dock", "pad"]) {
      const el = $(id);
      if (el.hidden) continue;
      bottom = Math.min(bottom, el.getBoundingClientRect().top - 10);
    }
  }
  view.layout({ x: 8, y: top, w: W - 16, h: Math.max(100, bottom - top) }, isPhone());
}
addEventListener("resize", () => syncChrome());
new ResizeObserver(() => relayout()).observe($("dock"));

// ---------- the frame loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const running = (S.screen === "play" || S.attract) && S.game && !S.game.dead && !S.frozen;
  if (running) {
    S.acc += S.fps * dt;
    S.acc = Math.min(S.acc, Math.max(4, S.fps * 0.1)); // no huge catch-up after a stall
    while (S.acc >= 1) {
      if (!stepOnce()) { S.acc = Math.min(S.acc, 1); break; }
      S.acc -= 1;
      if (S.game.dead) break;
    }
  }
  if (S.game && S.game.dead) {
    if (S.attract && !S.deadAt) S.deadAt = now;
    if (S.attract && now - S.deadAt > 2500) { S.deadAt = 0; startAttract(); }
    if (S.screen === "play" && !S.deadAt) { S.deadAt = now; }
    if (S.screen === "play" && now - S.deadAt > 1300) { S.deadAt = 0; gameOver(); }
  }
  view.fast = S.fps > 200;
  if (!S.paintHold) view.draw(now);
  syncHUD(false);
  requestAnimationFrame(frame);
}

function stepOnce() {
  const g = S.game;
  if (S.driver === "ai") return aiFrame(g);
  g.update(inputsThisFrame());
  return true;
}

// ---------- test hook ----------
window.tetris = {
  S, view,
  // stop the frame loop from advancing the game (tests then drive it with step())
  freeze(on = true) { S.frozen = on; },
  // for looking at effects: run `fn` (which triggers them), then draw `ms` of animation at
  // 60 fps right away and hold that picture until paintHold is cleared
  renderAfter(fn, ms) {
    S.paintHold = true;
    const t0 = performance.now();
    fn();
    for (let t = 0; t <= ms; t += 16) view.draw(t0 + t);
  },
  release() { S.paintHold = false; },
  Game, newGame, startPlay, startAttract, setDriver, setFps, setLevel, setDepth, togglePause,
  // advance n frames now (human: with the given held inputs; AI: waits are skipped by retrying)
  step(n = 1, inputs = null) {
    for (let i = 0; i < n; i++) {
      if (S.game.dead) break;
      if (S.driver === "ai") { if (!aiFrame(S.game)) return i; } else S.game.update(inputs ?? inputsThisFrame());
    }
    return n;
  },
  info() {
    const g = S.game;
    return {
      screen: S.screen, driver: S.driver, fps: S.fps, depth: S.depth,
      score: g.score, lines: g.totalLinesCleared, level: g.level, dead: g.dead, frame: g.frameCount,
      current: g.currentTetrimino && { type: g.currentTetrimino.pieceType, index: g.currentTetrimino.index, x: g.currentPosition.x, y: g.currentPosition.y },
      hold: g.holdTetrimino?.pieceType ?? null, next: g.getUpcomingTetriminos().map((t) => t.pieceType),
      held: [...held.keys()], aiPieces: S.aiStats.pieces, aiMs: S.aiStats.pieces ? S.aiStats.ms / S.aiStats.pieces : 0,
      stack: g.grid.slice(0, 20).map((r) => r.map((c) => c ?? ".").join("")).reverse(),
    };
  },
  state: () => S.game.toJSON(),
  load(json) { const g = Game.fromJSON(json); g.listener = onGameEvent; S.game = g; view.setGame(g); S.queue = []; S.pending = null; syncHUD(true); },
  layout: () => view.L,
};

// ---------- boot ----------
startWorker();
setDepth(1);
setFps(60, false);
setupAbout($("aboutBtn"), $("aboutTpl"), () => { if (S.screen === "play") togglePause(); });
if (params.has("play")) startPlay(params.get("play") === "ai" ? "ai" : "human");
else startAttract();
document.fonts?.ready.then(() => relayout());
requestAnimationFrame(frame);
