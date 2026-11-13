// Parity: the same cases through the original Python (parity/harness.py runs the vendored,
// unmodified source) and through this port, compared field by field. Needs python3 + numpy.
// PARITY_SCALE=n multiplies the case counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Game } from "../src/game.mjs";
import { AIGame, HighLevelAIGame, chooseActionDetailed } from "../src/ai.mjs";
import { makeRand, randomState, randomFrames, randomGrid } from "./parity-cases.mjs";
import { types } from "../src/tetrimino.mjs";

const SCALE = Number(process.env.PARITY_SCALE || 1);
const harness = fileURLToPath(new URL("../parity/harness.py", import.meta.url));

function python(cases) {
  const out = execFileSync("python3", [harness], { input: JSON.stringify(cases), maxBuffer: 1 << 30 });
  return JSON.parse(out.toString());
}

// --- the JS side of each case kind ---------------------------------------------------------
function jsFrames(c) {
  const g = Game.fromJSON(c.state);
  const states = [];
  const kicks = [];
  let tspins = 0;
  g.listener = (name, data) => {
    if (name === "rotate" && data.kick && (data.kick.x || data.kick.y)) kicks.push(data.kick);
    if (name === "lock" && data.tspin) tspins++;
  };
  for (const f of c.frames) {
    if (g.dead) break;
    g.update(f);
    states.push(g.toJSON());
  }
  return { states, kicks, tspins };
}

function jsMoves(c) {
  const ai = new HighLevelAIGame(Game.fromJSON(c.state));
  return ai.getLegalActions().map((a) => {
    const after = ai.move(a);
    return { inputs: ai.generateInputs(a), state: after.game.toJSON(), lines: after.lines, prevLines: after.prevLines, heuristic: after.heuristicScore() };
  });
}

function compareStates(js, py, label) {
  assert.equal(js.length, py.length, `${label}: number of frames`);
  for (let i = 0; i < js.length; i++) assert.deepEqual(js[i], py[i], `${label}: frame ${i}`);
}

test("frames: random states and held inputs, every field after every frame", () => {
  const r = makeRand(101);
  const cases = [];
  for (let i = 0; i < 300 * SCALE; i++) {
    cases.push({ kind: "frames", state: randomState(r), frames: randomFrames(r, 40 + r.int(160)) });
  }
  // stacks of nearly full rows, so drops clear lines (and score combos, back-to-backs, levels)
  for (let i = 0; i < 300 * SCALE; i++) {
    const state = randomState(r, { gridOpts: { height: 3 + r.int(10), nearFull: 0.95 } });
    cases.push({ kind: "frames", state, frames: randomFrames(r, 40 + r.int(160)) });
  }
  // T pieces dropped into T-shaped slots, for the T-spin scoring (including the 0-line one)
  for (let i = 0; i < 200 * SCALE; i++) cases.push({ kind: "frames", ...tSlot(r) });
  const py = python(cases);
  let frames = 0, clears = 0, deaths = 0, tspins = 0;
  cases.forEach((c, i) => {
    const { states, tspins: t } = jsFrames(c);
    tspins += t;
    compareStates(states, py[i], `case ${i}`);
    frames += states.length;
    clears += states.at(-1)?.totalLinesCleared - c.state.totalLinesCleared || 0;
    if (states.at(-1)?.dead) deaths++;
  });
  console.log(`  frames: ${cases.length} cases, ${frames} frames, ${clears} lines cleared, ${tspins} T-spins, ${deaths} deaths`);
  assert.ok(clears > 300, "cases should clear lines");
  assert.ok(tspins > 50, "cases should score T-spins");
});

// A T-shaped slot cut into a solid stack (3 wide on row y+1, 1 wide on row y), covered, with a
// pointing-down T already in it. Then: hard drop, wait out the lock delay, or try to rotate.
function tSlot(r) {
  const grid = randomGrid(r, { height: 0 });
  const y = r.int(4), x = 1 + r.int(7);
  const fullTo = y + 3;
  for (let yy = 0; yy < fullTo; yy++) for (let xx = 0; xx < 10; xx++) grid[yy][xx] = r.pick(types);
  // holes for the T in rotation 2 (point down): row y+1 = x-1..x+1, row y = x
  grid[y + 1][x - 1] = grid[y + 1][x] = grid[y + 1][x + 1] = null;
  grid[y][x] = null;
  // leave row y+1 or row y with other gaps sometimes so some T-spins clear 0, 1 or 2 lines
  if (r.chance(0.4)) grid[y + 1][(x + 3 + r.int(5)) % 10] = null;
  if (r.chance(0.4)) grid[y][(x + 3 + r.int(5)) % 10] = null;
  // the T starts already in the covered slot (it can't move in any direction), as if spun in
  const state = randomState(r, { grid, piece: "T" });
  state.current = ["T", 2];
  state.position = { x: x - 1, y };
  Object.assign(state, { rotateReleased: true, hardReleased: true, shiftTime: 0, lockTime: 0, level: r.pick([1, 6, 10]) });
  const frames = r.pick([[["HARD"], [], [], []], Array.from({ length: 40 }, () => []), [["RCW"], ["HARD"], []], Array.from({ length: 40 }, () => ["SOFT"])]);
  return { state, frames };
}

test("kicks: rotations of every piece wedged into dense stacks", () => {
  const r = makeRand(202);
  const cases = [];
  for (let i = 0; i < 1500 * SCALE; i++) {
    const piece = types[i % types.length];
    const state = randomState(r, { piece, tight: true, gridOpts: { height: 6 + r.int(8), density: 0.5 + r() * 0.3, nearFull: 0.1 } });
    state.rotateReleased = true;
    state.lockTime = 0;
    state.level = 1; // slow gravity: the piece stays put while it rotates
    const dir = r.chance(0.5) ? "RCW" : "RCCW";
    cases.push({ kind: "frames", state, frames: [[dir], [], [dir], [], [dir], [], [dir]] });
  }
  const py = python(cases);
  let kicked = 0;
  cases.forEach((c, i) => {
    const { states, kicks } = jsFrames(c);
    compareStates(states, py[i], `kick case ${i}`);
    kicked += kicks.length;
  });
  console.log(`  kicks: ${cases.length} cases, ${kicked} rotations used a non-zero kick`);
  assert.ok(kicked > 200, "cases should exercise the kick tables");
});

test("gravity: frames per row at every level, with and without soft drop", () => {
  const cases = [];
  for (let level = 1; level <= 60; level++) for (const soft of [false, true]) cases.push({ kind: "gravity", level, soft });
  const py = python(cases);
  cases.forEach((c, i) => {
    const g = new Game({ seed: 1 });
    g.level = c.level;
    g.isSoftDropping = c.soft;
    const js = g.getGravity();
    assert.ok(Math.abs(js - py[i]) <= 1e-12 * Math.abs(py[i]), `level ${c.level} soft ${c.soft}: ${js} vs ${py[i]}`);
    // the two decisions drop() makes from it must match exactly
    if (py[i] < 1) assert.equal(Math.trunc(1 / js), Math.trunc(1 / py[i]));
  });
});

test("heuristic: the four-feature score of random boards", () => {
  const r = makeRand(303);
  const cases = [];
  for (let i = 0; i < 400 * SCALE; i++) {
    const state = randomState(r, { gridOpts: { height: r.int(22), density: r(), nearFull: 0.2 } });
    cases.push({ kind: "features", state, prevLines: r.int(10), lines: r.int(14) });
  }
  const py = python(cases);
  cases.forEach((c, i) => {
    const ai = new AIGame(Game.fromJSON(c.state));
    ai.prevLines = c.prevLines;
    ai.lines = c.lines;
    assert.equal(ai.heuristicScore(), py[i], `case ${i}`);
  });
});

test("placements: every one of the 44 AI moves from random states (inputs, board, lines, score)", () => {
  const r = makeRand(404);
  const cases = [];
  for (let i = 0; i < 40 * SCALE; i++) {
    const state = randomState(r, { gridOpts: { height: r.int(12), nearFull: 0.5 } });
    // what the AI sees: a freshly spawned piece, released keys
    Object.assign(state, { rotateReleased: true, hardReleased: true, shiftTime: 0, lockTime: 0 });
    cases.push({ kind: "moves", state });
  }
  const py = python(cases);
  let lines = 0;
  cases.forEach((c, i) => {
    const js = jsMoves(c);
    assert.equal(js.length, py[i].length);
    js.forEach((m, k) => {
      assert.deepEqual(m.inputs, py[i][k].inputs, `case ${i} action ${k}: inputs`);
      assert.deepEqual(m.state, py[i][k].state, `case ${i} action ${k}: state`);
      assert.equal(m.lines, py[i][k].lines);
      assert.equal(m.prevLines, py[i][k].prevLines);
      assert.equal(m.heuristic, py[i][k].heuristic, `case ${i} action ${k}: heuristic`);
      lines += m.lines - m.prevLines;
    });
  });
  console.log(`  placements: ${cases.length * 44} moves, ${lines} lines cleared`);
  assert.ok(lines > 20);
});

function searchCases(r, n, depth) {
  const cases = [];
  // states from real play: the JS AI plays a seeded game, and we sample positions along the way
  let ai = new HighLevelAIGame(new Game({ seed: r.int(2 ** 31) }));
  while (cases.length < n) {
    if (ai.isDead()) ai = new HighLevelAIGame(new Game({ seed: r.int(2 ** 31) }));
    for (let k = 0; k < 3 + r.int(8); k++) if (!ai.isDead()) ai = ai.move(chooseActionDetailed(ai, 0, null, r).action);
    if (ai.isDead()) continue;
    const state = ai.game.toJSON();
    state.bag = state.bag.concat(Array.from({ length: 20 }, () => [r.pick(types), 0])); // never refills
    cases.push({ kind: "search", state, depth });
  }
  // and some messy random boards
  for (let i = 0; i < n; i++) {
    const state = randomState(r, { gridOpts: { height: r.int(10), nearFull: 0.4 } });
    Object.assign(state, { rotateReleased: true, hardReleased: true, shiftTime: 0, lockTime: 0 });
    cases.push({ kind: "search", state, depth });
  }
  return cases;
}

function checkSearch(cases, py) {
  cases.forEach((c, i) => {
    const res = chooseActionDetailed(new HighLevelAIGame(Game.fromJSON(c.state)), c.depth);
    assert.deepEqual(res.values, py[i].values, `case ${i}: values of the 44 moves`);
    const best = Math.max(...res.values);
    const pyIdx = res.actions.findIndex((a) => a[0] === py[i].chosen[0] && a[1] === py[i].chosen[1]);
    assert.equal(py[i].values[pyIdx], best, `case ${i}: Python chose a best move`);
    assert.equal(res.values[res.index], best, `case ${i}: JS chose a best move`);
  });
}

test("AI choice, depth 0 (one piece): the value of every move matches, both pick a best one", () => {
  const cases = searchCases(makeRand(505), 30 * SCALE, 0);
  checkSearch(cases, python(cases));
});

test("AI choice, depth 1 (two pieces): the value of every move matches", () => {
  const cases = searchCases(makeRand(606), 3 * SCALE, 1);
  checkSearch(cases, python(cases));
});

// unused here but handy when debugging a mismatch: node -e 'import("./test/parity-cases.mjs")'
export { randomGrid };
