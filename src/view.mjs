// Draws the well, pieces, previews and every effect onto one canvas, plus a copy of the bright
// parts onto a second canvas that CSS blurs into the glow underneath.
import { Tetrimino } from "./tetrimino.mjs";

export const PIECE_COLORS = {
  I: "#3fe0e6", O: "#ffd84a", T: "#b45cff", S: "#5be36a", Z: "#ff4d5e", J: "#4f72ff", L: "#ff9a3c",
};
const GARBAGE = "#3a3f63";
const VISIBLE = 20;      // rows 0..19
const VANISH = 2;        // rows 20..21 are drawn faded above the well (pieces spawn there)

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mix(h, w, t) {
  const a = hexToRgb(h), b = hexToRgb(w);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

// one glassy block per color and size, drawn once and reused
const spriteCache = new Map();
export function blockSprite(color, size, dpr) {
  const key = `${color}|${size}|${dpr}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  const px = Math.max(1, Math.round(size * dpr));
  c.width = c.height = px;
  const g = c.getContext("2d");
  const r = px * 0.16, inset = Math.max(1, px * 0.05);
  const round = (x, y, w, h, rr) => { g.beginPath(); g.roundRect(x, y, w, h, rr); };
  // body: lit from the top left
  const body = g.createLinearGradient(0, 0, px, px);
  body.addColorStop(0, mix(color, "#ffffff", 0.28));
  body.addColorStop(0.55, color);
  body.addColorStop(1, mix(color, "#000000", 0.35));
  round(inset, inset, px - 2 * inset, px - 2 * inset, r);
  g.fillStyle = body;
  g.fill();
  // inner face, slightly darker, so the edge reads as a bevel
  const face = g.createLinearGradient(0, 0, 0, px);
  face.addColorStop(0, mix(color, "#ffffff", 0.12));
  face.addColorStop(1, mix(color, "#000000", 0.18));
  round(px * 0.2, px * 0.2, px * 0.6, px * 0.6, r * 0.6);
  g.fillStyle = face;
  g.fill();
  // gloss along the top
  const gloss = g.createLinearGradient(0, inset, 0, px * 0.45);
  gloss.addColorStop(0, "rgba(255,255,255,.55)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  round(inset * 2, inset * 2, px - 4 * inset, px * 0.38, r * 0.8);
  g.fillStyle = gloss;
  g.fill();
  spriteCache.set(key, c);
  return c;
}

export class View {
  constructor(canvas, glow) {
    this.canvas = canvas;
    this.glow = glow;
    this.ctx = canvas.getContext("2d");
    this.gctx = glow.getContext("2d");
    this.game = null;
    this.fx = { particles: [], trails: [], flashes: [], rowFlashes: [], texts: [], rings: [], shake: null, fall: null, levelFlash: null, death: null, lockPulse: [] };
    this.drifters = [];
    this.candidates = null;
    this.fast = false;      // high sim speed: skip the slower animations
    this.hue = 0;           // well tint, follows the level
    this.targetHue = 0;
    this.lastNow = performance.now();
    this.L = null;
  }

  setGame(game) {
    this.game = game;
    this.candidates = null;
    for (const k of Object.keys(this.fx)) this.fx[k] = Array.isArray(this.fx[k]) ? [] : null;
    this.hue = this.targetHue = hueForLevel(game.level);
  }

  // rect: the free area in CSS px. Returns the layout (used by the page to place controls).
  layout(rect, phone) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const W = window.innerWidth, H = window.innerHeight;
    for (const c of [this.canvas, this.glow]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + "px";
      c.style.height = H + "px";
    }
    // the spawn rows above the well get less room on phones, where height is what limits the board
    const vanishShow = phone ? 0.7 : 0.9;
    const rowsTall = VISIBLE + VANISH * vanishShow;
    let cell, wellX, wellY, side, holdBox, nextBox, preview;
    if (phone) {
      const sideCells = 2.5, gapCells = 0.35;
      cell = Math.floor(Math.min(rect.h / rowsTall, (rect.w - 4) / (10 + sideCells + gapCells)));
      side = sideCells * cell;
      const total = 10 * cell + gapCells * cell + side;
      wellX = Math.round(rect.x + (rect.w - total) / 2);
      wellY = Math.round(rect.y + (rect.h - rowsTall * cell) / 2 + VANISH * vanishShow * cell);
      const sx = wellX + (10 + gapCells) * cell;
      preview = cell * 0.5;
      holdBox = { x: sx, y: wellY, w: side, h: 2.5 * cell };
      nextBox = { x: sx, y: wellY + 3.1 * cell, w: side, h: 7 * cell };
    } else {
      const sideCells = 4.6;
      cell = Math.floor(Math.min(rect.h / rowsTall, rect.w / (10 + 2 * (sideCells + 0.9))));
      cell = Math.min(cell, 42);
      side = sideCells * cell;
      wellX = Math.round(rect.x + (rect.w - 10 * cell) / 2);
      wellY = Math.round(rect.y + (rect.h - rowsTall * cell) / 2 + VANISH * 0.9 * cell);
      preview = cell * 0.82;
      holdBox = { x: wellX - 0.9 * cell - side, y: wellY, w: side, h: 3.6 * cell };
      nextBox = { x: wellX + 10.9 * cell, y: wellY, w: side, h: 10 * cell };
    }
    if (!(cell >= 6)) return this.L; // no room (hidden or tiny window): keep the last layout
    this.L = { cell, wellX, wellY, wellW: 10 * cell, wellH: VISIBLE * cell, holdBox, nextBox, preview, phone, W, H };
    if (!this.drifters.length) this.seedDrifters();
    return this.L;
  }

  // big faint piece outlines drifting up behind everything
  seedDrifters() {
    const types = Object.keys(PIECE_COLORS);
    const n = 9;
    for (let i = 0; i < n; i++) {
      this.drifters.push({
        // spread across the width in strata so they don't clump
        type: types[i % types.length], x: (i + 0.2 + Math.random() * 0.6) / n, y: Math.random(), size: 0.6 + Math.random() * 0.8,
        rot: Math.floor(Math.random() * 4), spin: (Math.random() - 0.5) * 0.12, angle: Math.random() * 6.28,
        speed: 0.006 + Math.random() * 0.012,
      });
    }
  }

  drawDrifters(ctx, dt) {
    const L = this.L, s0 = L.cell * 1.6;
    ctx.lineWidth = 1.5;
    for (const d of this.drifters) {
      d.y -= d.speed * dt * (this.fast ? 4 : 1);
      d.angle += d.spin * dt;
      const s = s0 * d.size;
      if (d.y < -0.15) d.y = 1.15;
      const cells = new Tetrimino(d.type, d.rot).offsets();
      ctx.save();
      ctx.translate(d.x * L.W, d.y * L.H);
      ctx.rotate(d.angle);
      ctx.strokeStyle = `hsla(${this.hue}, 70%, 72%, .045)`;
      ctx.fillStyle = `hsla(${this.hue}, 70%, 60%, .015)`;
      for (const p of cells) {
        ctx.beginPath(); ctx.roundRect((p.x - 1.5) * s, (1 - p.y) * s, s - 4, s - 4, s * 0.16);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawRings(ctx, g, now) {
    const fx = this.fx;
    fx.rings = fx.rings.filter((r) => now - r.t0 < 650);
    for (const r of fx.rings) {
      const t = (now - r.t0) / 650;
      const rad = this.L.wellW * (0.15 + 1.3 * ease(t));
      for (const k of [ctx, g]) {
        k.strokeStyle = rgba(PIECE_COLORS.I, 0.8 * (1 - t));
        k.lineWidth = this.L.cell * 0.35 * (1 - t) + 1;
        k.beginPath(); k.arc(r.x, r.y, rad, 0, Math.PI * 2); k.stroke();
      }
    }
  }

  // ---- coordinates ----
  sx(x) { return this.L.wellX + x * this.L.cell; }
  sy(y) { return this.L.wellY + (VISIBLE - 1 - y) * this.L.cell; } // top edge of row y

  // ---- events from the game ----
  event(name, data) {
    const now = performance.now();
    const fx = this.fx;
    if (!this.L) return;
    const c = this.L.cell;
    if (name === "hardDrop") {
      const color = PIECE_COLORS[data.piece.pieceType];
      if (data.dy > 0) {
        const cols = new Map();
        for (const o of data.piece.offsets()) {
          const x = data.from.x + o.x;
          const top = data.from.y + o.y, bottom = data.to.y + o.y;
          const cur = cols.get(x);
          if (!cur) cols.set(x, { top, bottom });
          else { cur.top = Math.max(cur.top, top); cur.bottom = Math.min(cur.bottom, bottom); }
        }
        fx.trails.push({ cols: [...cols].map(([x, v]) => ({ x, ...v })), color, t0: now });
      }
      const amp = Math.min(10, 2 + data.dy * 0.5);
      if (!this.fast || data.dy > 4) fx.shake = { amp, t0: now };
      // sparks off the bottom of the landed piece
      if (!this.fast) {
        for (const o of data.piece.offsets()) {
          if (data.piece.offsets().some((p) => p.x === o.x && p.y === o.y - 1)) continue;
          const x = this.sx(data.to.x + o.x) + c / 2, y = this.sy(data.to.y + o.y) + c;
          for (let i = 0; i < 4; i++) this.spark(x + (Math.random() - 0.5) * c, y, color, (Math.random() - 0.5) * 3, -Math.random() * 2.5, 0.5);
        }
      }
    } else if (name === "lock") {
      fx.lockPulse.push({ cells: data.cells, t0: now, color: PIECE_COLORS[data.piece.pieceType] });
      if (data.clears > 0) this.clearFx(data, now);
      this.candidates = null;
    } else if (name === "levelUp") {
      this.targetHue = hueForLevel(data);
      fx.levelFlash = { t0: now, level: data };
      fx.texts.push({ text: `Level ${data}`, t0: now, dur: 1500, size: 1.5, color: "#ffffff", y: 0.36, big: true });
    } else if (name === "death") {
      fx.death = { t0: now };
    } else if (name === "spawn" || name === "hold") {
      this.candidates = null;
    }
  }

  clearFx(data, now) {
    const fx = this.fx, c = this.L.cell;
    const n = data.clears;
    const names = ["", "Single", "Double", "Triple", "Tetris"];
    const label = data.tspin ? `T-spin ${names[n].toLowerCase()}` : names[n];
    fx.texts = fx.texts.filter((t) => t.big); // a new clear replaces the last small label
    const topRow = Math.max(...data.rows);
    const yFrac = (this.sy(Math.min(topRow, VISIBLE - 1)) - this.L.wellY) / this.L.wellH;
    if (n === 4) {
      const rows = data.rows.filter((r) => r < VISIBLE);
      const cy = rows.length ? (this.sy(Math.max(...rows)) + this.sy(Math.min(...rows)) + c) / 2 : this.L.wellY + this.L.wellH;
      fx.rings.push({ x: this.L.wellX + this.L.wellW / 2, y: cy, t0: now });
    }
    if (n === 4 || data.tspin) {
      fx.texts.push({ text: label, sub: data.scoreGain > 0 ? `+${data.scoreGain.toLocaleString()}` : "", t0: now, dur: 1300, size: n === 4 ? 1.35 : 1.0, color: n === 4 ? PIECE_COLORS.I : PIECE_COLORS.T, y: Math.max(0.2, yFrac - 0.08), big: true });
      fx.shake = { amp: n === 4 ? 14 : 8, t0: now };
    } else if (!this.fast) {
      fx.texts.push({ text: label, sub: data.scoreGain > 0 ? `+${data.scoreGain.toLocaleString()}` : "", t0: now, dur: 900, size: 0.7, color: "#ffffff", y: Math.max(0.15, yFrac - 0.06) });
    }
    // flash, then shatter, each cleared row
    data.rows.forEach((row, i) => {
      if (row >= VISIBLE + VANISH) return;
      fx.rowFlashes.push({ row, cells: data.rowCells[i] || [], t0: now, tetris: n === 4 });
      const cells = data.rowCells[i] || [];
      const y = this.sy(row) + c / 2;
      const per = this.fast ? 1 : 3;
      for (let x = 0; x < 10; x++) {
        const color = PIECE_COLORS[cells[x]] || "#ffffff";
        for (let k = 0; k < per; k++) {
          const dir = x < 5 ? -1 : 1;
          this.spark(this.sx(x) + Math.random() * c, y + (Math.random() - 0.5) * c, color,
            dir * (1 + Math.random() * 4) * (n === 4 ? 1.6 : 1), -1 - Math.random() * 4, 0.9 + Math.random() * 0.5, c * (0.12 + Math.random() * 0.14), 120);
        }
      }
    });
    // the stack above falls into place: new row k came from old row old[k]
    if (!this.fast) {
      const cleared = new Set(data.rows);
      const offsets = []; // offsets[k] = how many rows new row k fell
      for (let o = 0; o < 40; o++) if (!cleared.has(o)) offsets.push(o - offsets.length);
      fx.fall = { offsets, t0: now };
    }
  }

  spark(x, y, color, vx, vy, life, size = this.L.cell * 0.14, delay = 0) {
    if (this.fx.particles.length > 900) return;
    this.fx.particles.push({ x, y, vx, vy, life, age: -delay / 1000, color, size });
  }

  setCandidates(c) { this.candidates = c; }

  // ---- drawing ----
  draw(now) {
    const ctx = this.ctx, g = this.gctx, L = this.L, game = this.game;
    if (!L || !game) return;
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const dpr = this.dpr;
    for (const k of [ctx, g]) {
      k.setTransform(1, 0, 0, 1, 0, 0);
      k.clearRect(0, 0, this.canvas.width, this.canvas.height);
      k.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.hue += (this.targetHue - this.hue) * Math.min(1, dt * 2.5);
    const fx = this.fx, c = L.cell;

    // shake: a quick damped bounce downward
    let shakeY = 0;
    if (fx.shake) {
      const t = (now - fx.shake.t0) / 260;
      if (t >= 1) fx.shake = null;
      else shakeY = fx.shake.amp * Math.sin(t * Math.PI * 2.2) * (1 - t) * (1 - t);
    }
    this.drawDrifters(ctx, dt);
    ctx.save(); g.save();
    ctx.translate(0, shakeY); g.translate(0, shakeY);

    this.drawWell(ctx, g, now);
    this.drawStack(ctx, g, now);
    this.drawRowFlashes(ctx, g, now);
    this.drawTrails(ctx, g, now);
    if (!game.dead) {
      this.drawCandidates(ctx, now);
      this.drawGhostAndPiece(ctx, g, now);
    }
    this.drawLockPulses(ctx, g, now);
    this.drawParticles(ctx, g, dt);
    ctx.restore(); g.restore();

    this.drawPreviews(ctx, g);
    this.drawRings(ctx, g, now);
    this.drawTexts(ctx, g, now);
  }

  wellColors(now) {
    const h = this.hue;
    let danger = 0;
    const game = this.game;
    if (!game.dead) {
      let height = 0;
      for (let y = 0; y < 40; y++) if (game.grid[y].some((v) => v !== null)) height = y + 1;
      if (height > game.dangerZone) danger = 0.55 + 0.45 * Math.sin(now / 160);
    }
    return { h, danger };
  }

  drawWell(ctx, g, now) {
    const L = this.L, c = L.cell;
    const { h, danger } = this.wellColors(now);
    const x = L.wellX, y = L.wellY, w = L.wellW, hh = L.wellH;
    // floor of the well: a deep tinted gradient
    const bg = ctx.createLinearGradient(0, y, 0, y + hh);
    bg.addColorStop(0, `hsla(${h}, 55%, 9%, .92)`);
    bg.addColorStop(1, `hsla(${h}, 60%, 14%, .96)`);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(x - 4, y - 4, w + 8, hh + 8, 10); ctx.fill();
    // faint grid dots at cell corners
    ctx.fillStyle = `hsla(${h}, 60%, 70%, .10)`;
    for (let i = 1; i < 10; i++) for (let j = 1; j < VISIBLE; j++) ctx.fillRect(x + i * c - 1, y + j * c - 1, 2, 2);
    // walls: lit edges; red pulse in the danger zone
    let wall = `hsla(${h}, 90%, 66%, .85)`;
    if (danger > 0) wall = `rgba(255, ${Math.round(80 - 40 * danger)}, ${Math.round(90 - 50 * danger)}, ${0.6 + 0.4 * danger})`;
    let lw = 2;
    if (this.fx.levelFlash) {
      const t = (now - this.fx.levelFlash.t0) / 1400;
      if (t >= 1) this.fx.levelFlash = null;
      else { lw = 2 + 4 * (1 - t); wall = `hsla(${h}, 100%, ${66 + 30 * (1 - t)}%, 1)`; }
    }
    for (const k of [ctx, g]) {
      k.strokeStyle = wall;
      k.lineWidth = lw;
      k.beginPath();
      k.moveTo(x - 4, y - VANISH * 0.6 * c);
      k.lineTo(x - 4, y + hh + 4);
      k.lineTo(x + w + 4, y + hh + 4);
      k.lineTo(x + w + 4, y - VANISH * 0.6 * c);
      k.stroke();
    }
    // level-up sweep: a band of light rising up the well
    if (this.fx.levelFlash) {
      const t = (now - this.fx.levelFlash.t0) / 900;
      if (t < 1) {
        // a thin line of light rising up the well, added on top (not painted over)
        const by = y + hh - ease(t) * hh;
        const band = ctx.createLinearGradient(0, by - c, 0, by + c);
        band.addColorStop(0, `hsla(${h}, 100%, 70%, 0)`);
        band.addColorStop(0.5, `hsla(${h}, 100%, 75%, ${0.5 * (1 - t)})`);
        band.addColorStop(1, `hsla(${h}, 100%, 70%, 0)`);
        for (const k of [ctx, g]) {
          k.save();
          k.globalCompositeOperation = "lighter";
          k.fillStyle = band;
          k.fillRect(x, by - c, w, 2 * c);
          k.restore();
        }
      }
    }
  }

  blockAt(ctx, g, type, sx, sy, size, alpha = 1, glow = 0.5) {
    const color = PIECE_COLORS[type] || GARBAGE;
    const spr = blockSprite(color, size, this.dpr);
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr, sx, sy, size, size);
    ctx.globalAlpha = 1;
    if (glow > 0) {
      g.globalAlpha = alpha * glow;
      g.fillStyle = color;
      g.fillRect(sx + size * 0.15, sy + size * 0.15, size * 0.7, size * 0.7);
      g.globalAlpha = 1;
    }
  }

  drawStack(ctx, g, now) {
    const game = this.game, c = this.L.cell, fx = this.fx;
    let fallT = 1;
    if (fx.fall) {
      fallT = clamp01((now - fx.fall.t0 - 130) / 140);
      if (now - fx.fall.t0 > 300) fx.fall = null;
    }
    let deathRow = -1;
    if (fx.death) deathRow = VISIBLE + VANISH - Math.floor((now - fx.death.t0) / 45);
    for (let y = 0; y < VISIBLE + VANISH; y++) {
      const off = fx.fall ? (fx.fall.offsets[y] || 0) * (1 - ease(fallT)) : 0;
      const rowY = this.sy(y + off);
      const vanish = y >= VISIBLE;
      for (let x = 0; x < 10; x++) {
        const t = game.grid[y][x];
        if (t === null) continue;
        const dead = deathRow >= 0 && y >= deathRow;
        this.blockAt(ctx, g, dead ? null : t, this.sx(x), rowY, c, vanish ? 0.35 : 1, dead ? 0 : 0.35);
      }
    }
  }

  drawRowFlashes(ctx, g, now) {
    const fx = this.fx, c = this.L.cell;
    fx.rowFlashes = fx.rowFlashes.filter((r) => now - r.t0 < 260);
    for (const r of fx.rowFlashes) {
      const t = (now - r.t0) / 260;
      const y = this.sy(r.row);
      // the cleared blocks shrink toward the row's center line, glowing white
      const shrink = ease(t);
      for (let x = 0; x < 10; x++) {
        const color = PIECE_COLORS[r.cells[x]] || "#ffffff";
        const h = c * (1 - shrink);
        ctx.fillStyle = mix(color, "#ffffff", 0.75);
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.fillRect(this.sx(x) + 1, y + (c - h) / 2, c - 2, h);
      }
      ctx.globalAlpha = 1;
      // a beam across the well, wider than it
      const L = this.L;
      const beamW = L.wellW * (1 + 0.6 * ease(t));
      const bx = L.wellX + L.wellW / 2 - beamW / 2;
      for (const k of [ctx, g]) {
        k.fillStyle = r.tetris ? rgba(PIECE_COLORS.I, (1 - t) * 0.9) : `rgba(255,255,255,${(1 - t) * 0.7})`;
        k.fillRect(bx, y + c / 2 - c * 0.12 * (1 - t), beamW, c * 0.24 * (1 - t) + 1);
      }
    }
  }

  drawTrails(ctx, g, now) {
    const fx = this.fx, c = this.L.cell;
    fx.trails = fx.trails.filter((tr) => now - tr.t0 < 220);
    for (const tr of fx.trails) {
      const t = (now - tr.t0) / 220;
      for (const col of tr.cols) {
        const top = Math.min(col.top, VISIBLE + VANISH - 1);
        if (top <= col.bottom) continue;
        const yTop = this.sy(top), yBot = this.sy(col.bottom);
        const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
        grad.addColorStop(0, rgba(tr.color, 0));
        grad.addColorStop(1, rgba(tr.color, 0.55 * (1 - t)));
        const inset = c * (0.18 + 0.25 * t);
        for (const k of [ctx, g]) {
          k.fillStyle = grad;
          k.fillRect(this.sx(col.x) + inset, yTop, c - 2 * inset, yBot - yTop);
        }
      }
    }
  }

  drawLockPulses(ctx, g, now) {
    const fx = this.fx, c = this.L.cell;
    fx.lockPulse = fx.lockPulse.filter((p) => now - p.t0 < 180);
    for (const p of fx.lockPulse) {
      const t = (now - p.t0) / 180;
      ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - t)})`;
      for (const cell of p.cells) {
        if (cell.y >= VISIBLE + VANISH) continue;
        ctx.fillRect(this.sx(cell.x) + 2, this.sy(cell.y) + 2, c - 4, c - 4);
      }
    }
  }

  drawGhostAndPiece(ctx, g, now) {
    const game = this.game, c = this.L.cell;
    const t = game.currentTetrimino;
    if (!t) return;
    const color = PIECE_COLORS[t.pieceType];
    const ghost = game.getGhostPosition();
    const cells = game.getTetriminoActivePositions();
    const ghostCells = game.getTetriminoActivePositions(t, ghost);
    // a faint column of light from the piece down to where it will land
    const dy = game.currentPosition.y - ghost.y;
    if (dy > 0) {
      const xs = new Set(cells.map((p) => p.x));
      for (const x of xs) {
        const lo = Math.min(...ghostCells.filter((p) => p.x === x).map((p) => p.y));
        const hi = Math.min(...cells.filter((p) => p.x === x).map((p) => p.y));
        if (hi - 1 < lo) continue;
        const top = Math.min(hi - 1, VISIBLE - 1);
        if (top < lo) continue;
        const yTop = this.sy(top), yBot = this.sy(lo) + c;
        const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
        grad.addColorStop(0, rgba(color, 0.0));
        grad.addColorStop(1, rgba(color, 0.10));
        ctx.fillStyle = grad;
        ctx.fillRect(this.sx(x) + c * 0.2, yTop, c * 0.6, yBot - yTop);
      }
    }
    // ghost: outlined cells
    if (dy > 0) {
      ctx.lineWidth = Math.max(1.5, c * 0.07);
      for (const p of ghostCells) {
        if (p.y >= VISIBLE + VANISH) continue;
        const x = this.sx(p.x), y = this.sy(p.y);
        ctx.fillStyle = rgba(color, 0.12);
        ctx.strokeStyle = rgba(color, 0.75);
        ctx.beginPath(); ctx.roundRect(x + 2.5, y + 2.5, c - 5, c - 5, c * 0.14);
        ctx.fill(); ctx.stroke();
      }
    }
    // lock-delay hint: the piece dims a little as its lock timer runs
    const lockFrac = game.isOnGround() ? Math.min(1, game.lockTime / game.lockDelay) : 0;
    for (const p of cells) {
      if (p.y >= VISIBLE + VANISH) continue;
      const vanish = p.y >= VISIBLE;
      this.blockAt(ctx, g, t.pieceType, this.sx(p.x), this.sy(p.y), c, vanish ? 0.45 : 1 - 0.3 * lockFrac, 0.7);
    }
  }

  // the AI's best few landings, faint, and its pick, bright
  drawCandidates(ctx, now) {
    const cand = this.candidates, c = this.L.cell;
    if (!cand || this.fast || !this.game.currentTetrimino) return;
    const age = (now - cand.t0) / 1000;
    const fade = clamp01(age * 6);
    ctx.lineWidth = Math.max(1, c * 0.05);
    cand.top.forEach((k, rank) => {
      const best = rank === 0;
      const a = (best ? 0.95 : 0.45 * (1 - rank / cand.top.length)) * fade;
      ctx.setLineDash(best ? [] : [c * 0.18, c * 0.14]);
      // the AI's pick in its yellow (the badge, the Take over button); runners-up faint
      ctx.strokeStyle = best ? `rgba(255,216,74,${a})` : `rgba(180,200,255,${a})`;
      ctx.lineWidth = best ? Math.max(1.5, c * 0.08) : Math.max(1, c * 0.05);
      for (const p of k.cells) {
        if (p.y >= VISIBLE + VANISH) continue;
        ctx.strokeRect(this.sx(p.x) + c * 0.3, this.sy(p.y) + c * 0.3, c * 0.4, c * 0.4);
      }
    });
    ctx.setLineDash([]);
  }

  drawParticles(ctx, g, dt) {
    const ps = this.fx.particles;
    const grav = this.L.cell * 0.9;
    let w = 0;
    for (const p of ps) {
      p.age += dt;
      if (p.age < 0) { ps[w++] = p; continue; }
      if (p.age > p.life) continue;
      p.vy += grav * dt * 0.6;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      const a = 1 - p.age / p.life;
      for (const k of [ctx, g]) {
        k.globalAlpha = a;
        k.fillStyle = p.color;
        k.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ps[w++] = p;
    }
    ps.length = w;
    ctx.globalAlpha = 1; g.globalAlpha = 1;
  }

  drawPreviews(ctx, g) {
    const L = this.L, game = this.game;
    const label = (text, box) => {
      ctx.font = `700 ${Math.max(11, Math.round(L.cell * (L.phone ? 0.42 : 0.4)))}px Outfit, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(200,210,255,.6)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(text, box.x + L.cell * 0.3, box.y + L.cell * 0.22);
    };
    const panel = (box) => {
      ctx.fillStyle = "rgba(20,24,54,.78)";
      ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 12); ctx.fill();
      ctx.strokeStyle = "rgba(60,70,130,.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    const drawMini = (t, cx, cy, size, alpha, glow) => {
      // the shape without its empty rows/columns, centered on (cx, cy)
      const cells = new Tetrimino(t.pieceType, 0).offsets();
      const xs = cells.map((p) => p.x), ys = cells.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = (maxX - minX + 1) * size, h = (maxY - minY + 1) * size;
      for (const p of cells) {
        this.blockAt(ctx, g, t.pieceType, cx - w / 2 + (p.x - minX) * size, cy + h / 2 - (p.y - minY + 1) * size, size, alpha, glow);
      }
    };
    const hb = L.holdBox, nb = L.nextBox, s = L.preview;
    panel(hb); label("Hold", hb);
    if (game.holdTetrimino) drawMini(game.holdTetrimino, hb.x + hb.w / 2, hb.y + hb.h * 0.6, s, game.canHold ? 1 : 0.3, game.canHold ? 0.3 : 0);
    panel(nb); label("Next", nb);
    const ups = game.getUpcomingTetriminos();
    const slot = (nb.h - L.cell * 0.9) / 3;
    ups.forEach((t, i) => drawMini(t, nb.x + nb.w / 2, nb.y + L.cell * 0.9 + slot * (i + 0.5), i === 0 ? s : s * 0.85, i === 0 ? 1 : 0.8, 0.25));
  }

  drawTexts(ctx, g, now) {
    const L = this.L, fx = this.fx;
    fx.texts = fx.texts.filter((t) => now - t.t0 < t.dur);
    for (const t of fx.texts) {
      const p = (now - t.t0) / t.dur;
      const pop = p < 0.15 ? ease(p / 0.15) : 1;
      const a = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      const size = L.cell * t.size * (0.7 + 0.3 * pop) * (L.phone ? 1.1 : 1);
      const x = L.wellX + L.wellW / 2;
      const y = L.wellY + L.wellH * t.y - p * L.cell * 0.8;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `400 ${Math.round(size)}px Bungee, Outfit, sans-serif`;
      if (t.big) ctx.rotate(0);
      ctx.lineWidth = Math.max(3, size * 0.14);
      ctx.strokeStyle = "rgba(8,9,24,.9)";
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
      g.globalAlpha = a * 0.8;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = ctx.font; g.fillStyle = t.color;
      g.fillText(t.text, x, y);
      g.globalAlpha = 1;
      if (t.sub) {
        ctx.font = `700 ${Math.round(size * 0.55)}px Outfit, sans-serif`;
        ctx.lineWidth = Math.max(3, size * 0.1);
        ctx.strokeText(t.sub, x, y + size * 0.85);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(t.sub, x, y + size * 0.85);
      }
      ctx.restore();
    }
  }
}

// each level turns the well's tint further around the color wheel, starting from indigo
export function hueForLevel(level) { return 232 + (level - 6) * 29; }
