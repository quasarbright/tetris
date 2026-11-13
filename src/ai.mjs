// Port of TetrisAI/aiGame.py and minimax.py.
//
// The AI never looks at frames. A "move" is a placement: (shift, rotation), with shift in
// -5..5 columns from where the piece is now and rotation 0..3 quarter turns clockwise. To make
// a move it presses real inputs, one frame at a time (rotate, then shift with a released frame
// between taps so DAS never kicks in, then hard drop), through the same Game.update a human uses.
// The search tries every move, scores the resulting boards with four weighted features, and
// picks the best. Heuristics from
// https://codemyroad.wordpress.com/2013/04/14/tetris-ai-the-near-perfect-player/

import { Game, HOLD, RCW, RCCW, LEFT, RIGHT, SOFT, HARD } from "./game.mjs";
import { shuffle } from "./rng.mjs";

// the four weights, copied from the article via the Python
export const WEIGHTS = { aggregateHeight: -0.510066, clears: 0.760666, holes: -0.35663, bumpiness: -0.184483 };

// no hold
const lowLevelActions = [HOLD, RCW, RCCW, LEFT, RIGHT, SOFT, HARD];

// The four features of a board, as the Python computes them (rows 0..lastVisibleRow only).
export function features(game) {
  const W = game.width, top = game.lastVisibleRow;
  // QUIRK: a column's "height" is the 0-based row index of its highest block (default 0),
  // so a column with one block on the floor counts as height 0, same as an empty column
  const heights = new Array(W);
  for (let x = 0; x < W; x++) {
    let h = 0;
    for (let y = 0; y <= top; y++) if (game.grid[y][x] !== null) h = y;
    heights[x] = h;
  }
  let aggregateHeight = 0;
  for (const h of heights) aggregateHeight += h;
  // QUIRK: a "hole" is an empty cell with a block directly above it, so a gap under a
  // 3-tall overhang counts once, not three times
  let holes = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y <= top; y++) {
      if (y <= top - 1 && game.grid[y][x] === null && game.grid[y + 1][x] !== null) holes += 1;
    }
  }
  let bumpiness = 0;
  for (let x = 0; x + 1 < W; x++) bumpiness += Math.abs(heights[x] - heights[x + 1]);
  return { heights, aggregateHeight, holes, bumpiness };
}

export class AIGame {
  constructor(game = null) {
    this.game = game !== null ? game : new Game();
    this.lines = this.game.totalLinesCleared;
    this.prevLines = this.lines;
  }

  copy() {
    const ans = new this.constructor(this.game.copy());
    ans.lines = this.lines;
    ans.prevLines = this.prevLines;
    return ans;
  }

  getLegalActions() { return [...lowLevelActions, null]; }

  move(action) {
    const ans = this.copy();
    ans.game.aiUpdate(action === null ? [null] : [action]);
    ans.prevLines = ans.lines;
    ans.lines = ans.game.totalLinesCleared;
    return ans;
  }

  isDead() { return this.game.dead; }
  score() { return this.game.score; }

  heuristicScore() {
    const f = features(this.game);
    const clears = this.lines - this.prevLines; // lines just cleared
    const a = WEIGHTS.aggregateHeight, b = WEIGHTS.clears, c = WEIGHTS.holes, d = WEIGHTS.bumpiness;
    return a * f.aggregateHeight + b * clears + c * f.holes + d * f.bumpiness;
  }

  key() { return this.game.key(); }
}

const POSITIONS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
export const HIGH_LEVEL_ACTIONS = POSITIONS.flatMap((p) => [0, 1, 2, 3].map((r) => [p, r]));

// Instead of single inputs, a move is a (position, rotation) pair: doing the move hard drops
// the piece at that x offset with that rotation.
export class HighLevelAIGame extends AIGame {
  getLegalActions() {
    // (holding is left out: for heuristic agents, putting a piece down is almost always worse
    // than holding, so they'd just stall)
    return HIGH_LEVEL_ACTIONS.map((a) => a.slice());
  }

  move(action) {
    const ans = this.copy();
    const game = ans.game;
    for (const inputsHeld of this.generateInputs(action)) game.update(inputsHeld);
    // wait for the new tetrimino to spawn
    while (game.spawnRequired) game.update([]);
    ans.prevLines = ans.lines;
    ans.lines = game.totalLinesCleared;
    return ans;
  }

  // The low-level inputs for a high-level action: a list of frames, each a list of inputs
  generateInputs(action) {
    if (action === HOLD) return [[HOLD]];
    const ans = this.copy();
    const game = ans.game;
    const inputs = [], shifts = [], rotations = [];
    while (!ans.game.canMove()) {
      game.update();
      inputs.push([]);
    }
    const [position, rotation] = action;
    if (rotation === 1) rotations.push([RCW]);
    else if (rotation === 2) rotations.push([RCW], [], [RCW]);
    else if (rotation === 3) rotations.push([RCCW]);

    // a released frame between taps, so it never charges DAS
    if (position < 0) for (let i = 0; i < -position; i++) shifts.push([LEFT], []);
    else if (position > 0) for (let i = 0; i < position; i++) shifts.push([RIGHT], []);

    inputs.push(...rotations, ...shifts);
    inputs.push([HARD]);
    // so consecutive hard drops aren't one long press
    inputs.push([]);
    return inputs;
  }
}

// minimax.chooseAction. Single-player, so "minimax" is a max over every sequence of
// maxDepth+1 moves; the first move of the best sequence wins, ties broken at random.
// Returns { action, values } where values[i] is the value of getLegalActions()[i].
export function chooseActionDetailed(game, maxDepth = 10, scoreFun = null, rand = Math.random) {
  scoreFun = scoreFun || ((g) => g.heuristicScore());
  // keyed on (state, depth); the key ignores some fields, as the Python's hash/eq did
  const memo = new Map();
  let nodes = 0;
  function value(g, depth) {
    const k = depth + "#" + g.key();
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    nodes++;
    const actions = g.getLegalActions();
    let ans;
    if (depth <= 0 || actions.length === 0 || g.isDead()) {
      ans = scoreFun(g);
    } else {
      ans = -Infinity;
      for (const a of actions) {
        const v = value(g.move(a), depth - 1);
        if (v > ans) ans = v;
      }
    }
    memo.set(k, ans);
    return ans;
  }
  const actions = game.getLegalActions();
  const values = actions.map((a) => value(game.move(a), maxDepth));
  // Python: shuffle the actions, then max() keeps the first maximal one it meets
  const order = shuffle(actions.map((_, i) => i), rand);
  let best = order[0];
  for (const i of order) if (values[i] > values[best]) best = i;
  return { action: actions[best], index: best, values, actions, nodes };
}

export function chooseAction(game, maxDepth = 10, scoreFun = null, rand = Math.random) {
  return chooseActionDetailed(game, maxDepth, scoreFun, rand).action;
}

// The live controller from aiController.HighLevelController: one frame per call. Skips the
// entry delay, asks for a move when its queue is empty, then feeds one frame of inputs.
// `choose(state)` returns an action synchronously; the page uses the async version below.
export function highLevelControllerStep(game, queue, choose) {
  if (game.dead) return queue;
  while (game.spawnRequired) game.update([]); // skip waiting for the piece, looks faster
  let inputsHeld = [];
  if (queue.length === 0) {
    const action = choose(new HighLevelAIGame(game));
    queue = new HighLevelAIGame(game).generateInputs(action);
  }
  if (queue.length > 0) inputsHeld = queue.shift();
  game.update(inputsHeld);
  return queue;
}

export { SOFT };
