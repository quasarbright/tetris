// Seeded generators for parity cases: board states (sparse to dense, near-full rows, overhangs),
// pieces placed in tight spots, and runs of held inputs. Every bag is long so no case ever
// needs a fresh random bag (Python and JS shuffle with different generators).
import { Game, LEFT, RIGHT, SOFT, HARD, RCW, RCCW, HOLD } from "../src/game.mjs";
import { Tetrimino, types } from "../src/tetrimino.mjs";
import { mulberry32 } from "../src/rng.mjs";

export function makeRand(seed) {
  const r = mulberry32(seed);
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[r.int(arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

const W = 10, H = 40;

function emptyGrid() { return Array.from({ length: H }, () => new Array(W).fill(null)); }

// A stack: `height` rows from the floor. Each row is either nearly full (one or two gaps, to
// make clears) or random at `density`; occasionally a cell is left floating to make overhangs.
export function randomGrid(r, { height = r.int(14), density = 0.4 + r() * 0.5, nearFull = r() * 0.6 } = {}) {
  const grid = emptyGrid();
  for (let y = 0; y < height; y++) {
    if (r.chance(nearFull)) {
      const gaps = new Set([r.int(W)]);
      if (r.chance(0.3)) gaps.add(r.int(W));
      for (let x = 0; x < W; x++) grid[y][x] = gaps.has(x) ? null : r.pick(types);
    } else {
      for (let x = 0; x < W; x++) grid[y][x] = r.chance(density) ? r.pick(types) : null;
      if (grid[y].every((c) => c !== null)) grid[y][r.int(W)] = null; // keep rows unclear
    }
  }
  return grid;
}

function bag(r, n = 40) { return Array.from({ length: n }, () => [r.pick(types), 0]); }

// a free spot for the piece: at spawn if possible (normal play), else somewhere low and tight
function place(game, r, preferLow) {
  const t = game.currentTetrimino;
  if (!preferLow && !game.isTetriminoObstructedAt(t, game.spawnPosition)) {
    game.currentPosition = { ...game.spawnPosition };
    return true;
  }
  for (let tries = 0; tries < 400; tries++) {
    t.index = r.int(4);
    const p = { x: r.int(W + 2) - 1, y: r.int(preferLow ? 12 : 22) - 1 };
    if (!game.isTetriminoObstructedAt(t, p)) {
      game.currentPosition = p;
      return true;
    }
  }
  return false;
}

// A random game state as plain JSON. opts.tight puts the piece low inside the stack (kicks).
export function randomState(r, opts = {}) {
  for (;;) {
    const g = new Game({ seed: r.int(2 ** 31) });
    g.grid = opts.grid ? opts.grid.map((row) => row.slice()) : randomGrid(r, opts.gridOpts);
    g.bag = bag(r).map(([t, i]) => new Tetrimino(t, i));
    g.currentTetrimino = new Tetrimino(opts.piece || r.pick(types), 0);
    g.holdTetrimino = r.chance(0.5) ? new Tetrimino(r.pick(types), 0) : null;
    if (!place(g, r, !!opts.tight)) continue;
    g.level = opts.level ?? r.pick([1, 2, 6, 6, 6, 8, 10, 12, 15, 18, 20, 25, 30, 40]);
    g.linesThisLevel = r.int(g.level * 5);
    g.comboCount = r.chance(0.3) ? r.int(4) : 0;
    g.lastClearDifficult = r.chance(0.3);
    g.tspinPending = false;
    g.canHold = r.chance(0.8);
    g.score = r.int(50000);
    g.totalLinesCleared = r.int(100);
    g.shiftTime = r.chance(0.6) ? 0 : r.int(30);
    g.lockTime = r.chance(0.6) ? 0 : r.int(30);
    g.timeSinceDrop = r.int(40);
    g.rotateReleased = r.chance(0.8);
    g.hardReleased = r.chance(0.8);
    g.frameCount = r.int(1000);
    return g.toJSON();
  }
}

const COMBOS = [
  [], [], [LEFT], [RIGHT], [SOFT], [HARD], [RCW], [RCCW], [HOLD], [LEFT, RIGHT], [RCW, RCCW],
  [LEFT, RCW], [RIGHT, RCCW], [LEFT, SOFT], [RIGHT, HARD], [SOFT, RCW], [HOLD, HARD], [LEFT, HARD],
];

// runs of held inputs: a combo held 1..24 frames (long holds exercise DAS), with taps between
export function randomFrames(r, n) {
  const frames = [];
  while (frames.length < n) {
    const combo = r.pick(COMBOS);
    const len = r.chance(0.5) ? 1 + r.int(3) : 1 + r.int(24);
    for (let i = 0; i < len && frames.length < n; i++) frames.push(combo.slice());
  }
  return frames;
}
