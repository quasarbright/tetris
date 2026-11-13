// Port of TetrisAI/game.py: guideline-style marathon Tetris that advances one 60 Hz frame per
// update(). Kept line-for-line with the Python, quirks included; each quirk that differs from
// the official guideline is marked "QUIRK" (and listed in README.md).
//
// Coordinates: x = column 0..9 from the left, y = row 0..39 from the BOTTOM. Rows 0..19 are the
// visible playfield. A piece's position is the bottom-left corner of its rotation matrix.

import { Tetrimino, makeTetrimino, types, T } from "./tetrimino.mjs";
import { mulberry32, shuffle } from "./rng.mjs";

export const HOLD = "HOLD", RCW = "RCW", RCCW = "RCCW", LEFT = "LEFT", RIGHT = "RIGHT", SOFT = "SOFT", HARD = "HARD";
export const actions = [HOLD, RCW, RCCW, LEFT, RIGHT, SOFT, HARD, HOLD];

const vec = (x, y) => ({ x, y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const DOWN = vec(0, -1);

export class Game {
  // opts.seed: seed for the bag shuffles. opts.rand: a random() function to use instead.
  // opts.empty: skip the constructor's first bag + spawn (used by copy / fromJSON).
  constructor(opts = {}) {
    this.rand = opts.rand || mulberry32(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.width = 10;
    this.height = 40;
    this.previewSize = 3; // how many pieces you see in the future
    this.spawnPosition = vec(3, 19);
    this.lastVisibleRow = 19;
    this.frameRate = 60;
    this.dangerZone = 13; // last safe height

    // timing
    this.frameCount = 0;
    this.lockDelay = 0.5 * this.frameRate; // half second
    this.lockTime = 0; // time spent on ground
    this.autoShiftDelay = Math.trunc((16 * this.frameRate) / 60);
    this.autoRepeatRate = (6 * this.frameRate) / 60;
    if (this.autoRepeatRate > 1) this.autoRepeatRate = Math.trunc(this.autoRepeatRate);
    this.shiftTime = 0; // how long left or right has been held
    this.autoEntryRate = Math.trunc((10 * this.frameRate) / 60);
    this.spawnWaitTime = 0; // how long to wait until spawning the next piece (after locking)
    this.timeSinceDrop = 0;

    // flags and counts
    this.canHold = true;
    this.isSoftDropping = false;
    this.softDropCount = 0;
    this.rotateReleased = true;
    this.hardReleased = true;
    this.spawnRequired = false;
    this.dead = false;
    this.score = 0;
    this.totalLinesCleared = 0;
    this.level = 6; // QUIRK: marathon starts at level 6, not 1
    this.linesThisLevel = 0;
    this.comboCount = 0;
    this.lastClearDifficult = false;
    this.tspinPending = false;

    // the page subscribes here for effects and sounds; copies get none
    this.listener = null;

    // row zero is bottom
    this.grid = Array.from({ length: this.height }, () => new Array(this.width).fill(null));
    this.bag = []; // last element is next
    this.holdTetrimino = null;
    this.currentTetrimino = null;
    this.currentPosition = null;
    if (!opts.empty) {
      this.updateBag();
      this.spawnTetrimino();
    }
  }

  emit(name, data) { if (this.listener) this.listener(name, data, this); }

  // rand: the random() the copy shuffles new bags with. By default a copy does NOT share the
  // live game's seeded generator, so searching ahead never changes which pieces the real game
  // deals. (In Python both used the global `random`.)
  copy(rand = Math.random) {
    const g = Object.create(Game.prototype);
    Object.assign(g, this);
    g.rand = rand;
    g.grid = this.grid.map((row) => row.slice());
    g.bag = this.bag.map((t) => t.copy());
    if (this.currentTetrimino) g.currentTetrimino = this.currentTetrimino.copy();
    if (this.holdTetrimino) g.holdTetrimino = this.holdTetrimino.copy();
    g.currentPosition = { ...this.currentPosition };
    g.listener = null;
    return g;
  }

  canMove() { return this.currentTetrimino !== null || this.spawnWaitTime === 1; }

  getUpcomingTetriminos() { return this.bag.slice(-this.previewSize).reverse(); }

  getGhostPosition() {
    if (this.currentTetrimino === null) return this.currentPosition;
    let p = this.currentPosition, prev = p;
    const tet = this.currentTetrimino;
    while (!this.isTetriminoObstructedAt(tet, p)) {
      prev = p;
      p = add(p, DOWN);
    }
    return prev;
  }

  getPieceAt(x, y) {
    if (typeof x === "object") return this.grid[x.y][x.x];
    return this.grid[y][x];
  }

  // Python defaults: a null tetrimino or position means "the current one"
  getTetriminoActivePositions(tetrimino = null, p = null) {
    if (tetrimino === null) tetrimino = this.currentTetrimino;
    if (p === null) p = this.currentPosition;
    if (tetrimino === null) return [];
    return tetrimino.offsets().map((o) => vec(p.x + o.x, p.y + o.y));
  }

  getLinesGoal() { return this.level * 5; }

  // frames per one-cell drop
  getGravity() {
    const level = this.level;
    // QUIRK: the guideline curve is (0.8 - (level-1)*0.007)^(level-1); this has 0.0007, so
    // gravity speeds up more slowly than the guideline's (level 15 is ~0.06 s/row, not ~0.007)
    let seconds = Math.pow(0.8 - (level - 1) * 0.0007, level - 1);
    if (this.isSoftDropping) {
      // QUIRK: soft drop adds 20 rows/second rather than multiplying gravity by 20
      let vel = 1 / seconds;
      vel += 20;
      seconds = 1 / vel;
    }
    return seconds * this.frameRate;
  }

  // the 1-indexed height of the stack: index of the first empty row
  getHeight() {
    for (let y = 0; y < this.height; y++) {
      if (!this.grid[y].some((c) => c !== null)) return y;
    }
    throw new Error("RuntimeError: grid is full");
  }

  isInBounds(p) { return p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height; }

  isBadPosition(p) { return !this.isInBounds(p) || this.grid[p.y][p.x] !== null; }

  isTetriminoObstructedAt(tetrimino = null, p = null) {
    if (tetrimino === null) tetrimino = this.currentTetrimino;
    if (p === null) p = this.currentPosition;
    if (tetrimino === null) return false; // no active positions
    for (const o of tetrimino.offsets()) {
      const x = p.x + o.x, y = p.y + o.y;
      if (x < 0 || x >= this.width || y < 0 || y >= this.height || this.grid[y][x] !== null) return true;
    }
    return false;
  }

  isOnGround() { return this.isTetriminoObstructedAt(null, add(this.currentPosition, DOWN)); }

  setPieceAt(piece, p) { this.grid[p.y][p.x] = piece; }

  // 7-bag: when fewer than 7 are queued, a shuffled bag of all 7 goes on the far end
  updateBag() {
    if (this.bag.length < 7) {
      const fresh = shuffle(types.map(makeTetrimino), this.rand);
      this.bag = fresh.concat(this.bag);
    }
  }

  popBag() {
    const ans = this.bag.pop();
    this.updateBag();
    return ans;
  }

  spawnTetrimino(tetrimino = null) {
    if (tetrimino === null) tetrimino = this.popBag();
    this.currentTetrimino = tetrimino;
    this.currentPosition = this.spawnPosition;
    // QUIRK (matches the guideline's "block out" only): you die when a piece can't spawn
    if (this.isTetriminoObstructedAt(this.currentTetrimino, this.currentPosition)) {
      if (!this.dead) this.onDeath();
      this.dead = true;
    }
    this.canHold = true;
  }

  clearRows() {
    let clearCount = 0;
    const rows = [], rowCells = [];
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.grid[y].every((c) => c !== null)) {
        rows.push(y);
        if (this.listener) rowCells.push(this.grid[y].slice());
        this.grid.splice(y, 1);
        this.grid.push(new Array(this.width).fill(null));
        clearCount++;
      }
    }
    // for the page's effects only: which rows (indices before the clear, top first) and their blocks
    this.lastClearedRows = rows;
    this.lastClearedRowCells = rowCells;
    return clearCount;
  }

  rotateCCW() { this._rotateHelp(false); }
  rotateCW() { this._rotateHelp(true); }

  _rotateHelp(isCw) {
    const rotated = this.currentTetrimino.copy();
    const kicks = isCw ? rotated.rotateCW() : rotated.rotateCCW();
    if (!this.isTetriminoObstructedAt(rotated, this.currentPosition)) {
      this.currentTetrimino = rotated;
      this.onSuccessfulRotate(isCw, null);
    } else {
      for (const kick of kicks) {
        const p = add(this.currentPosition, kick);
        if (!this.isTetriminoObstructedAt(rotated, p)) {
          this.currentTetrimino = rotated;
          this.currentPosition = p;
          this.onSuccessfulRotate(isCw, kick);
          break;
        }
      }
    }
  }

  moveLeft() {
    const p = add(this.currentPosition, vec(-1, 0));
    if (!this.isTetriminoObstructedAt(this.currentTetrimino, p)) {
      this.currentPosition = p;
      this.onSuccessfulShift(-1);
    }
  }

  moveRight() {
    const p = add(this.currentPosition, vec(1, 0));
    if (!this.isTetriminoObstructedAt(this.currentTetrimino, p)) {
      this.currentPosition = p;
      this.onSuccessfulShift(1);
    }
  }

  // drop according to gravity. only call once per frame since it handles a counter
  drop() {
    let g = this.getGravity();
    if (g < 1) {
      // faster than a row per frame: drop int(1/g) rows this frame
      g = Math.trunc(1 / g);
      this.dropByN(g);
    } else if (this.timeSinceDrop > g) {
      this.dropBy1();
    }
  }

  dropByN(n) { for (let i = 0; i < n; i++) this.dropBy1(); }

  dropBy1() {
    // QUIRK: with no current piece (the frame a piece locks) this still "succeeds": the
    // position drifts down and a held soft drop still counts a row of soft-drop score
    const p = add(this.currentPosition, DOWN);
    if (!this.isTetriminoObstructedAt(this.currentTetrimino, p)) {
      this.currentPosition = p;
      this.timeSinceDrop = 0;
      if (this.isSoftDropping) this.softDropCount += 1;
    }
  }

  hardDrop() {
    const ghost = this.getGhostPosition();
    const dy = this.currentPosition.y - ghost.y;
    this.score += dy * 2;
    this.emit("hardDrop", { from: this.currentPosition, to: ghost, dy, piece: this.currentTetrimino });
    this.currentPosition = this.getGhostPosition();
    this.lock();
    this.timeSinceDrop = 0;
  }

  // if they haven't held since the last lock: reset the current piece, spawn the held one
  // (or the next from the bag), and hold the current one
  hold() {
    if (this.canHold) {
      this.currentTetrimino.reset();
      const temp = this.currentTetrimino;
      this.spawnTetrimino(this.holdTetrimino);
      this.holdTetrimino = temp;
      this.canHold = false;
      this.softDropCount = 0;
      // QUIRK: lockTime and timeSinceDrop carry over to the new piece
      this.emit("hold");
    }
  }

  // puts the current tetrimino into the stack and potentially clears lines
  assimilateIntoStack() {
    if (this.currentTetrimino === null) return;
    const t = this.currentTetrimino.pieceType;

    if (t === T) {
      // QUIRK: a "T-spin" is any T that can't move up, down, left or right when it locks;
      // there's no check that the last move was a rotation, and no 3-corner rule
      const dirs = [vec(1, 0), vec(-1, 0), vec(0, 1), vec(0, -1)];
      if (dirs.every((d) => this.isTetriminoObstructedAt(this.currentTetrimino, add(this.currentPosition, d)))) {
        this.onTSpin();
      }
    }

    const oldHeight = this.getHeight();
    const cells = this.getTetriminoActivePositions();
    for (const p of cells) this.setPieceAt(t, p);
    const lockedPiece = this.currentTetrimino;
    const clears = this.clearRows();
    const newHeight = this.getHeight();
    const before = { score: this.score, level: this.level, tspin: this.tspinPending };
    this.onClears(clears);
    this.currentTetrimino = null;
    this.spawnRequired = true;
    this.spawnWaitTime = this.autoEntryRate;
    const enteredDanger = newHeight > this.dangerZone && oldHeight <= this.dangerZone;
    const exitedDanger = newHeight <= this.dangerZone && oldHeight > this.dangerZone;
    this.emit("lock", {
      cells, piece: lockedPiece, clears, rows: this.lastClearedRows, rowCells: this.lastClearedRowCells, tspin: before.tspin,
      scoreGain: this.score - before.score, enteredDanger, exitedDanger,
    });
    this.lockTime = 0;
    this.score += this.softDropCount;
    this.softDropCount = 0;
  }

  lock() { this.assimilateIntoStack(); }

  // like update, but inserts an empty input to avoid DAS
  aiUpdate(inputsHeld = []) {
    this.update([]);
    this.update(inputsHeld);
  }

  // advances the game 1 frame. inputsHeld: values like LEFT, RIGHT, SOFT, RCW, ...
  update(inputsHeld = []) {
    const has = (a) => inputsHeld.includes(a);
    const left = has(LEFT), right = has(RIGHT), soft = has(SOFT), hard = has(HARD);
    const rcw = has(RCW), rccw = has(RCCW), hold = has(HOLD);

    // allow DAS charging when piece isn't spawned
    const shiftTimeWasZero = this.shiftTime === 0;
    if (left !== right) this.shiftTime += 1;
    else this.shiftTime = 0;

    if (!hard) this.hardReleased = true;
    if (!(rccw || rcw)) this.rotateReleased = true;

    if (this.spawnRequired) {
      if (this.spawnWaitTime === 0) {
        this.spawnTetrimino();
        this.spawnRequired = false;
        this.emit("spawn");
      } else {
        this.spawnWaitTime -= 1;
      }
    } else {
      if (left !== right) {
        if (shiftTimeWasZero) {
          if (left) this.moveLeft();
          else if (right) this.moveRight();
        } else if (this.shiftTime > this.autoShiftDelay) {
          const timeSinceDelay = this.shiftTime - this.autoShiftDelay;
          if (this.autoRepeatRate < 1) {
            for (let i = 0; i < Math.trunc(1 / this.autoRepeatRate); i++) {
              if (left) this.moveLeft();
              else if (right) this.moveRight();
            }
          } else if (timeSinceDelay % this.autoRepeatRate === 0) {
            if (left) this.moveLeft();
            else if (right) this.moveRight();
          }
        }
      }

      if (rcw && rccw) {
        // both: nothing
      } else if (rcw && this.rotateReleased) {
        this.rotateCW();
        this.rotateReleased = false;
      } else if (rccw && this.rotateReleased) {
        this.rotateCCW();
        this.rotateReleased = false;
      }

      if (this.canHold && hold) this.hold();

      // hard drop after shift/rotate so doing them in the same frame gets the shift/rotate
      if (hard && this.hardReleased) {
        this.hardDrop();
        this.hardReleased = false;
      }

      this.isSoftDropping = soft;
      this.timeSinceDrop += 1;
      this.drop();

      if (this.isOnGround()) this.lockTime += 1;
      if (this.lockTime >= this.lockDelay) this.lock();
    }

    this.frameCount += 1;
  }

  onTSpin() { this.tspinPending = true; }

  // "NES scoring, guideline levelling" (from the Python docstring). The values are the
  // guideline's, times the level.
  onClears(clears) {
    this.totalLinesCleared += clears;
    let fac = this.level;
    const oldDifficult = this.lastClearDifficult;
    const tspin = this.tspinPending;
    if (tspin) this.tspinPending = false;

    if (clears === 4 || (tspin && clears > 0)) this.lastClearDifficult = true;
    // QUIRK: lastClearDifficult is never set back to false, so after the first tetris or
    // T-spin clear every later lock, of any kind, gets the 1.5x back-to-back factor
    if (oldDifficult && this.lastClearDifficult) fac *= 3 / 2;

    let dlines;
    if (clears === 1) {
      dlines = 1;
      this.score += tspin ? 800 * fac : 100 * fac;
    } else if (clears === 2) {
      dlines = 3;
      this.score += tspin ? 1200 * fac : 300 * fac;
    } else if (clears === 3) {
      dlines = 5;
      // QUIRK: a T-spin triple uses the level, without the back-to-back factor
      this.score += tspin ? 1600 * this.level : 500 * fac;
    } else if (clears === 4) {
      dlines = 8;
      this.score += 800 * fac;
    } else {
      dlines = 0;
      // QUIRK: `self.score = 400 * fac` in the Python: a T-spin with no lines REPLACES
      // the score instead of adding to it
      if (tspin) this.score = 400 * fac;
    }

    // QUIRK: the combo counter starts at 1 on the first clear, so every clear gets
    // 50 * level on top (the guideline starts the bonus on the second clear in a row)
    if (clears === 0) this.comboCount = 0;
    else this.comboCount += 1;
    this.score += 50 * this.comboCount * this.level;

    // variable goal: 1/3/5/8 "lines" for single/double/triple/tetris, goal = 5 * level.
    // QUIRK: T-spins earn no extra goal lines, and lines past the goal don't carry over
    this.linesThisLevel += dlines;
    let leveled = false;
    if (this.linesThisLevel >= this.getLinesGoal()) {
      this.level += 1;
      this.linesThisLevel = 0;
      leveled = true;
    }
    this.score = Math.trunc(this.score); // fac makes it a float for b2b
    if (clears >= 1 && clears <= 3) this.emit("clear", clears);
    if (clears === 4) this.emit("tetris");
    if (leveled) this.emit("levelUp", this.level);
  }

  onDeath() { this.emit("death"); }

  onSuccessfulRotate(isCw, kick) {
    this.emit("rotate", { cw: isCw, kick });
    this.onSuccessfulAnything();
  }

  onSuccessfulShift(dir) {
    this.emit("shift", dir);
    this.onSuccessfulAnything();
  }

  // QUIRK: every successful shift or rotation resets the lock timer, with no limit
  // (the guideline caps this at 15 resets)
  onSuccessfulAnything() { this.lockTime = 0; }

  // Equality key, as Game.keyAttributes in Python: score, level, position, current piece
  // state, hold state, grid and bag. Used by the search's memo.
  key() {
    const p = this.currentPosition;
    let s = `${this.score}|${this.level}|${p.x},${p.y}|${this.currentTetrimino ? this.currentTetrimino.stateKey() : "-"}|`;
    s += `${this.holdTetrimino ? this.holdTetrimino.stateKey() : "-"}|`;
    for (const row of this.grid) for (const c of row) s += c === null ? "." : c;
    s += "|";
    for (const t of this.bag) s += t.stateKey() + ",";
    return s;
  }

  // Plain-data snapshot (for the AI worker and the parity tests)
  toJSON() {
    const out = {};
    for (const k of SCALARS) out[k] = this[k];
    out.grid = this.grid.map((r) => r.slice());
    out.bag = this.bag.map((t) => [t.pieceType, t.index]);
    out.current = this.currentTetrimino ? [this.currentTetrimino.pieceType, this.currentTetrimino.index] : null;
    out.hold = this.holdTetrimino ? [this.holdTetrimino.pieceType, this.holdTetrimino.index] : null;
    out.position = { ...this.currentPosition };
    return out;
  }

  static fromJSON(o, rand = Math.random) {
    const g = new Game({ empty: true, rand });
    for (const k of SCALARS) if (k in o) g[k] = o[k];
    g.grid = o.grid.map((r) => r.slice());
    while (g.grid.length < g.height) g.grid.push(new Array(g.width).fill(null));
    g.bag = o.bag.map(([t, i]) => new Tetrimino(t, i));
    g.currentTetrimino = o.current ? new Tetrimino(o.current[0], o.current[1]) : null;
    g.holdTetrimino = o.hold ? new Tetrimino(o.hold[0], o.hold[1]) : null;
    g.currentPosition = { ...o.position };
    return g;
  }
}

const SCALARS = [
  "frameCount", "lockTime", "shiftTime", "spawnWaitTime", "timeSinceDrop", "canHold", "isSoftDropping",
  "softDropCount", "rotateReleased", "hardReleased", "spawnRequired", "dead", "score", "totalLinesCleared",
  "level", "linesThisLevel", "comboCount", "lastClearDifficult", "tspinPending",
];
