// Port of TetrisAI/tetrimino.py.
// A tetrimino is a piece type plus a rotation index (0..3, increasing = clockwise). The shape
// for each rotation is a small matrix whose row 0 is the TOP row; game.mjs flips it so y grows
// upward on the board.

export const I = "I", J = "J", L = "L", Z = "Z", S = "S", T = "T", O = "O";
export const types = [I, J, L, Z, S, T, O];

// The original pygame colors, kept for reference and for tests. The page restyles them.
export const typeToColor = {
  I: [21, 194, 188], J: [53, 75, 219], L: [217, 156, 33], Z: [217, 33, 33],
  S: [61, 217, 33], T: [146, 33, 217], O: [217, 211, 33],
};

const bases = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  // O is 3 rows by 4 columns, not square
  O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]],
};

// numpy's rot90(m, k): rotate counterclockwise k times
export function rot90(m, k = 1) {
  k = ((k % 4) + 4) % 4;
  for (let n = 0; n < k; n++) {
    const r = m.length, c = m[0].length;
    const out = [];
    for (let i = 0; i < c; i++) {
      const row = [];
      for (let j = 0; j < r; j++) row.push(m[j][c - 1 - i]);
      out.push(row);
    }
    m = out;
  }
  return m;
}

// Kick tables, copied exactly. Note what the original has and lacks:
// - every list starts with (0, 0), which _rotateHelp has already tried
// - the J/L/S/T/Z table has no (0, 1) entry, so a clockwise turn out of the spawn
//   orientation never kicks (SRS has 0->R: (-1,0) (-1,+1) (0,-2) (-1,-2))
const jlstzKicks = {
  "1,0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1,2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2,1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2,3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3,2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3,0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0,3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const iKicks = {
  "0,1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1,0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1,2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2,1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2,3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3,2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3,0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0,3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

function toVecs(table) {
  const out = {};
  for (const k in table) out[k] = table[k].map(([x, y]) => ({ x, y }));
  return out;
}

// Per type: the 4 rotation matrices, the kicks, and the precomputed active cells per rotation
// (in matrix coordinates: x = column, y = matrix row, row 0 on top) plus the matrix height.
const protos = {};
for (const t of types) {
  const base = bases[t];
  const rotations = t === O ? [base, base, base, base] : [base, rot90(base, 3), rot90(base, 2), rot90(base, 1)];
  const kicks = t === I ? toVecs(iKicks) : t === O ? {} : toVecs(jlstzKicks);
  const active = rotations.map((m) => {
    const cells = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[0].length; x++) if (m[y][x] === 1) cells.push({ x, y });
    return cells;
  });
  // the active cells already flipped so y grows upward, relative to the piece position
  // (game.getTetriminoActivePositions does: y = (rows - 1) - y)
  const offsets = rotations.map((m, i) => active[i].map((p) => ({ x: p.x, y: m.length - 1 - p.y })));
  // a key that is equal exactly when Python's Tetrimino.__eq__ would be (same state matrix)
  const stateKeys = rotations.map((m) => m.map((r) => r.join("")).join("/"));
  protos[t] = { rotations, kicks, active, offsets, stateKeys };
}

export class Tetrimino {
  constructor(pieceType, index = 0) {
    if (!protos[pieceType]) throw new Error(`unknown type: ${pieceType}`);
    this.pieceType = pieceType;
    this.index = index;
  }
  copy() { return new Tetrimino(this.pieceType, this.index); }
  getKicks(oldIndex, newIndex) { return protos[this.pieceType].kicks[`${oldIndex},${newIndex}`] || []; }
  rotateCW() {
    const old = this.index;
    this.index = (this.index + 1) % 4;
    return this.getKicks(old, this.index);
  }
  rotateCCW() {
    const old = this.index;
    this.index = (((this.index - 1) % 4) + 4) % 4;
    return this.getKicks(old, this.index);
  }
  getState() { return protos[this.pieceType].rotations[this.index]; }
  getActivePositions() { return protos[this.pieceType].active[this.index]; }
  // cells relative to the piece position with y up (see protos.offsets)
  offsets() { return protos[this.pieceType].offsets[this.index]; }
  reset() { this.index = 0; }
  getColor() { return typeToColor[this.pieceType]; }
  // equality as in Python: same state matrix
  stateKey() { return protos[this.pieceType].stateKeys[this.index]; }
  equals(other) { return other instanceof Tetrimino && other.stateKey() === this.stateKey(); }
}

export function makeTetrimino(pieceType) { return new Tetrimino(pieceType); }
