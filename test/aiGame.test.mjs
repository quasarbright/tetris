// Port of TetrisAI/aiGameTest.py (the only test file for the game and AI; montecarloTest.py
// only has a setUp for the abandoned Monte Carlo agent, which isn't ported).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, RCW, RCCW, LEFT, RIGHT, HARD } from "../src/game.mjs";
import { HighLevelAIGame } from "../src/ai.mjs";
import { Tetrimino, O, I } from "../src/tetrimino.mjs";

test("testGenerateInputs", () => {
  const game = new HighLevelAIGame(new Game({ seed: 1 }));
  // empties are necessary bc of DAS; there are some extraneous ones though
  assert.deepEqual(game.generateInputs([0, 1]), [[RCW], [HARD], []]);
  assert.deepEqual(game.generateInputs([-1, 0]), [[LEFT], [], [HARD], []]);
  assert.deepEqual(game.generateInputs([-1, 1]), [[RCW], [LEFT], [], [HARD], []]);
  assert.deepEqual(game.generateInputs([3, 2]),
    [[RCW], [], [RCW], [RIGHT], [], [RIGHT], [], [RIGHT], [], [HARD], []]);
  assert.deepEqual(game.generateInputs([-2, 3]), [[RCCW], [LEFT], [], [LEFT], [], [HARD], []]);
  assert.deepEqual(game.generateInputs([0, 0]), [[HARD], []]);
});

test("testHardAfterMove", () => {
  // Whole game is just O pieces. Put one all the way to the left and another in the middle.
  // Regression test: hard drop, release, wait for spawn, then hard drop right as it spawns.
  let game = new HighLevelAIGame(new Game({ seed: 2 }));
  game.game.bag = Array.from({ length: 500 }, () => new Tetrimino(O));
  game.game.currentTetrimino = new Tetrimino(O);
  game = game.move([-4, 0]);
  assert.deepEqual(game.game.grid[0], [O, O, null, null, null, null, null, null, null, null]);
  game = game.move([0, 0]);
  assert.deepEqual(game.game.grid[0], [O, O, null, null, O, O, null, null, null, null]);
});

test("testTetrisOfLines", () => {
  // the bag is all I pieces; put them down vertically left to right. The 10th is a tetris.
  let game = new HighLevelAIGame(new Game({ seed: 3 }));
  game.game.bag = Array.from({ length: 500 }, () => new Tetrimino(I));
  game.game.currentTetrimino = new Tetrimino(I);
  assert.equal(game.game.totalLinesCleared, 0);
  for (let x = -4; x < 6; x++) game = game.move([x, 3]);
  assert.equal(game.game.totalLinesCleared, 4);
});
