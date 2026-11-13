// The about modal and its two live diagrams. Both run the real game and AI code on a small
// fixed board: one plays a placement's actual key presses frame by frame, the other scores
// every distinct placement with the real heuristic and walks up to the best.
import { openModal } from "https://quasarbright.github.io/sketches/shared/cohesion.js";
import { Game, LEFT, RIGHT, HARD, RCW, RCCW } from "./game.mjs";
import { Tetrimino } from "./tetrimino.mjs";
import { HighLevelAIGame, features, WEIGHTS } from "./ai.mjs";
import { PIECE_COLORS } from "./view.mjs";

// a mid-game board (bottom row first), with a T to place
const SAMPLE = [
  "LLL.JJZZOO",
  "L.SSJIZZOO",
  "SSSIJIJJ.T",
  "S.JIJ.J.TT",
  ".JJ.....T.",
];

function sampleGame() {
  const g = new Game({ seed: 1 });
  g.grid = Array.from({ length: g.height }, (_, y) => {
    const row = SAMPLE[y];
    return Array.from({ length: g.width }, (_, x) => (row && row[x] !== "." ? row[x] : null));
  });
  g.bag = "IOLJSZOI".split("").map((t) => new Tetrimino(t));
  g.currentTetrimino = new Tetrimino("T");
  g.currentPosition = { ...g.spawnPosition };
  return g;
}

function drawCell(ctx, x, y, s, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x + 1, y + 1, s - 2, s - 2, s * 0.18); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fillRect(x + s * 0.18, y + s * 0.16, s * 0.64, s * 0.14);
  ctx.globalAlpha = 1;
}

// Draw some rows of a game's grid (+ the current piece and an outline) at (ox, oy).
// rows: a count (rows 0..n-1), or a list of row indices bottom to top; where the list skips
// rows, a dashed break is drawn instead.
function drawBoard(ctx, g, ox, oy, s, rows, { piece = true, outline = null } = {}) {
  const list = typeof rows === "number" ? Array.from({ length: rows }, (_, i) => i) : rows;
  const GAP = 0.7;
  // screen y of each listed row, from the top
  const pos = new Map();
  let y = oy;
  for (let i = list.length - 1; i >= 0; i--) {
    pos.set(list[i], y);
    y += s;
    if (i > 0 && list[i - 1] !== list[i] - 1) y += GAP * s;
  }
  ctx.fillStyle = "#151a44";
  ctx.beginPath(); ctx.roundRect(ox - 3, oy - 3, 10 * s + 6, y - oy + 6, 6); ctx.fill();
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1] === list[i] - 1) continue;
    const gy = pos.get(list[i - 1]) - GAP * s / 2;
    ctx.strokeStyle = "#3a4280"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox, gy); ctx.lineTo(ox + 10 * s, gy); ctx.stroke(); ctx.setLineDash([]);
  }
  const sy = (r) => pos.get(r);
  for (const r of list) for (let x = 0; x < 10; x++) {
    const t = g.grid[r][x];
    if (t) drawCell(ctx, ox + x * s, sy(r), s, PIECE_COLORS[t]);
  }
  if (outline) {
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2;
    for (const p of outline) if (pos.has(p.y)) ctx.strokeRect(ox + p.x * s + 2, sy(p.y) + 2, s - 4, s - 4);
  }
  if (piece && g.currentTetrimino) {
    for (const p of g.getTetriminoActivePositions()) if (pos.has(p.y)) drawCell(ctx, ox + p.x * s, sy(p.y), s, PIECE_COLORS[g.currentTetrimino.pieceType]);
  }
  return sy;
}

const KEY_LABEL = { [LEFT]: "←", [RIGHT]: "→", [HARD]: "drop", [RCW]: "X", [RCCW]: "Z" };

// ---- diagram 1: a placement is a list of frames of key presses ----
function movesDiagram(canvas, cap) {
  const ctx = canvas.getContext("2d");
  const base = new HighLevelAIGame(sampleGame());
  const showcase = [[0, 0], [-3, 1], [4, 2], [2, 3], [-5, 0], [3, 1], [-1, 2]];
  let k = 0, frames = null, f = 0, sim = null, hold = 0, landed = null;
  const begin = () => {
    const action = showcase[k % showcase.length];
    frames = base.generateInputs(action);
    sim = base.copy();
    f = 0; hold = 0; landed = null;
    sim.game.listener = (name, d) => { if (name === "lock") landed = d.cells; };
    const [p, r] = action;
    cap.textContent = `shift ${p > 0 ? "+" + p : p}, turn ${r}: ${frames.length} frames of input`;
  };
  begin();
  let acc = 0, lastT = performance.now();
  return (now) => {
    acc += (now - lastT) / 1000 * 8; // 8 frames a second, slow enough to follow
    lastT = now;
    while (acc >= 1) {
      acc -= 1;
      if (f < frames.length) { sim.game.update(frames[f]); f++; }
      else if (++hold > 14) { k++; begin(); }
    }
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // the spawn rows at the top, the stack at the bottom, the empty middle cut out
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 17, 18, 19, 20, 21];
    const s = Math.floor((H - 20) / (rows.length + 0.7));
    drawBoard(ctx, sim.game, 18, 10, s, rows, { piece: !landed, outline: landed });
    // the frames as key chips, the current one lit
    const x0 = 18 + 10 * s + 28, chipW = 52, chipH = 22;
    ctx.font = "600 13px Outfit, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#9aa2d4";
    ctx.fillText("frame by frame", x0 + chipW * 1.5 + 6, 22);
    frames.forEach((fr, i) => {
      const col = Math.floor(i / 11), row = i % 11;
      const x = x0 + col * (chipW + 12), y = 40 + row * (chipH + 1.5);
      const on = i === f - 1, done = i < f - 1;
      ctx.fillStyle = on ? "#ffd84a" : done ? "#2a3068" : "#1e2350";
      ctx.beginPath(); ctx.roundRect(x, y, chipW, chipH - 3, 5); ctx.fill();
      ctx.fillStyle = on ? "#2a2000" : fr.length ? "#eef0ff" : "#5e6699";
      ctx.fillText(fr.length ? fr.map((a) => KEY_LABEL[a] || a).join("+") : "—", x + chipW / 2, y + chipH / 2 - 1);
    });
  };
}

// ---- diagram 2: every distinct placement, scored ----
function scoreDiagram(canvas, cap) {
  const ctx = canvas.getContext("2d");
  const base = new HighLevelAIGame(sampleGame());
  // distinct resulting boards, worst to best
  const seen = new Map();
  for (const a of base.getLegalActions()) {
    const after = base.move(a);
    const key = after.game.grid.slice(0, 12).map((r) => r.map((c) => c ?? ".").join("")).join("/");
    if (!seen.has(key)) seen.set(key, { action: a, after, score: after.heuristicScore(), f: features(after.game), clears: after.lines - after.prevLines });
  }
  const list = [...seen.values()].sort((a, b) => a.score - b.score);
  let i = 0, t0 = performance.now();
  return (now) => {
    const showing = list[i];
    const isBest = i === list.length - 1;
    if (now - t0 > (isBest ? 3200 : 700)) { i = (i + 1) % list.length; t0 = now; }
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const rows = 9, s = Math.min(Math.floor((H - 40) / rows), Math.floor((W - 170) / 10));
    const g = showing.after.game;
    const sy = drawBoard(ctx, g, 16, 12, s, rows, { piece: false });
    // heights under the columns, holes ringed
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    showing.f.heights.forEach((h, x) => { ctx.fillStyle = "#9aa2d4"; ctx.fillText(String(h), 16 + x * s + s / 2, 12 + rows * s + 6); });
    ctx.strokeStyle = "#ff4d5e"; ctx.lineWidth = 2;
    for (let x = 0; x < 10; x++) for (let y = 0; y < rows - 1; y++) {
      if (g.grid[y][x] === null && g.grid[y + 1][x] !== null) {
        ctx.beginPath(); ctx.arc(16 + x * s + s / 2, sy(y) + s / 2, s * 0.32, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // the sum
    const x0 = 16 + 10 * s + 26;
    const lines = [
      ["height", showing.f.aggregateHeight, WEIGHTS.aggregateHeight],
      ["lines", showing.clears, WEIGHTS.clears],
      ["holes", showing.f.holes, WEIGHTS.holes],
      ["bumpiness", showing.f.bumpiness, WEIGHTS.bumpiness],
    ];
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const step = 46;
    lines.forEach(([name, v, w], k) => {
      const y = 22 + k * step;
      ctx.font = "600 13px Outfit, sans-serif";
      ctx.fillStyle = name === "holes" ? "#ff8a96" : "#9aa2d4";
      ctx.fillText(name, x0, y);
      ctx.font = "500 14px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#eef0ff";
      ctx.fillText(`${v} × ${w.toFixed(3)}`, x0, y + 18);
    });
    const yt = 22 + 4 * step;
    ctx.strokeStyle = "#262c56"; ctx.beginPath(); ctx.moveTo(x0, yt - 14); ctx.lineTo(W - 12, yt - 14); ctx.stroke();
    ctx.font = "400 22px Bungee, sans-serif";
    ctx.fillStyle = isBest ? "#ffd84a" : "#eef0ff";
    ctx.fillText(showing.score.toFixed(2), x0, yt + 8);
    ctx.font = "600 13px Outfit, sans-serif";
    ctx.fillStyle = "#9aa2d4";
    ctx.fillText(isBest ? "best" : `${i + 1} of ${list.length}`, x0, yt + 34);
    const [p, r] = showing.action;
    cap.textContent = isBest
      ? `The best of the ${list.length} different boards: shift ${p}, turn ${r}. This is the move it makes.`
      : `Board ${i + 1} of ${list.length}, worst first (shift ${p}, turn ${r}).`;
  };
}

export function setupAbout(button, tpl, onOpen) {
  let raf = 0;
  button.addEventListener("click", () => {
    onOpen?.();
    const { el } = openModal(tpl.innerHTML, { className: "cohesion-about", onClose: () => cancelAnimationFrame(raf) });
    const dpr = Math.min(2, devicePixelRatio || 1);
    const setup = (id, capId, make) => {
      const c = el.querySelector("#" + id);
      // draw in CSS px at the canvas's attribute size, backing store scaled by dpr
      const w = c.width, h = c.height;
      c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext("2d");
      const proxy = { getContext: () => ctx, width: w, height: h };
      ctx.scale(dpr, dpr);
      return make(proxy, el.querySelector("#" + capId));
    };
    const a = setup("aboutMoves", "aboutMovesCap", movesDiagram);
    const b = setup("aboutScore", "aboutScoreCap", scoreDiagram);
    const tick = (now) => { a(now); b(now); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  });
}
