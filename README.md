# Tetris AI

A browser port of my 2020 [TetrisAI](https://github.com/quasarbright/TetrisAI): marathon Tetris
you can play yourself or hand to the AI, which searches over piece placements with four board
heuristics and plays them as real key presses. The game rules and the AI are line-for-line
ports of the pygame/Python code; the visuals are new.

Run it with any static server from this folder, e.g. `python3 -m http.server`, and open
`index.html`. Query options: `?play=human` or `?play=ai` to skip the start screen, `?seed=N`
for a fixed piece order.

## Controls

Keyboard: ← → move, ↓ soft drop, space hard drop, Z / X rotate (↑ also rotates clockwise),
shift hold (C also holds), Esc or P pause, A hand the game to the AI or take it back, M sound.
On a phone, on-screen buttons hold their input while pressed, so auto-repeat works the same.

While the AI plays: **speed** sets game frames per second (60 is normal, up to 6,000) and
**looks ahead** picks the search depth (1 piece = `maxDepth` 0, 2 pieces = `maxDepth` 1).
Gravity only comes from the level, which goes up as lines are cleared.

## Layout

- `src/tetrimino.mjs`, `src/game.mjs`: the game (`tetrimino.py`, `game.py`)
- `src/ai.mjs`: `AIGame`, `HighLevelAIGame`, `minimax.chooseAction` and the live controller
  (`aiGame.py`, `minimax.py`, `aiController.py`)
- `src/ai-worker.mjs`: runs the search in a Web Worker
- `src/view.mjs`, `src/main.mjs`, `src/about.mjs`, `src/audio.mjs`: the page
- `parity/python/`: the original Python files, unmodified (GPL-3.0, as is this port)

The Monte Carlo tree search agent and the REINFORCE experiments from the original repo aren't
ported; the game never used them.

## Tests

```
npm install
npm run test:unit     # ported aiGameTest.py + parity tests (needs python3 with numpy)
npm run test:e2e      # Playwright: Chromium, Firefox, and a 375×812 touch phone
```

`test/aiGame.test.mjs` is `aiGameTest.py` ported. (`montecarloTest.py` only has a `setUp` for
the unported MCTS agent.) `test/parity.test.mjs` generates seeded cases, runs them through
`parity/harness.py` (which imports the original Python) and through the port, and compares:

- every field of the game state after every frame, for random boards and runs of held inputs
  (DAS, rotation, hold, soft and hard drops), near-full boards (line clears, combos,
  back-to-back, level ups) and T pieces in covered slots (T-spin scoring)
- rotations of every piece wedged into dense stacks (the kick tables)
- gravity at levels 1 to 60, with and without soft drop
- the heuristic score of random boards
- all 44 AI placements from random states: the generated inputs, the resulting state, lines,
  heuristic
- the AI's value for every move at depth 0 and 1, and that both sides pick a best move

`PARITY_SCALE=5 npm run test:parity` runs five times as many cases.

## Where the original differs from the Tetris guideline

The port keeps all of these. Each is marked `QUIRK` in the source.

- **Starting level is 6.**
- **Gravity** uses `(0.8 - (level-1) * 0.0007)^(level-1)` seconds per row; the guideline has
  `0.007`. Early levels are a little slower than the guideline's and later ones much slower.
  There's no 20G cap: level 18 is about one row per frame, level 30 about 23.
- **Soft drop** adds 20 rows per second to the fall speed instead of multiplying it by 20.
- **Kicks**: the J/L/S/T/Z table has no entry for spawn → clockwise, so that one rotation never
  kicks. (Every other entry matches SRS. Each list starts with the unkicked `(0, 0)` test.)
- **Lock delay** is 30 frames and resets on every successful move or rotation, with no limit
  on resets. Holding keeps the lock timer from the piece you held.
- **T-spins**: any T that can't move up, down, left or right when it locks counts, no matter
  how it got there.
- **Back-to-back**: once you've made a tetris or T-spin clear, every later clear (of any kind)
  gets the 1.5× bonus, because the flag is never reset.
- **T-spin with no lines** sets the score to `400 × level` instead of adding it.
- **T-spin triple** uses the level without the back-to-back factor.
- **Combos**: every clear adds `50 × combo × level`, and the combo counter is already 1 on the
  first clear of a streak.
- **Level goal**: `5 × level` goal lines, with 1/3/5/8 for single/double/triple/tetris.
  T-spins earn no extra goal lines, and lines past the goal don't carry over.
- **Spawn** is at rows 20 and 21, just above the 20 visible rows, and you only lose when a new
  piece can't spawn.
- **DAS**: 16 frames, then a move every 6 frames. Rotating needs a release between turns.
- **Entry delay**: 10 frames between a lock and the next spawn (the AI controller skips it).
- The heuristic's column **height** is the row index of the top block (a lone floor block
  counts 0), and a **hole** is an empty cell with a block directly above.

## Differences from the pygame version that aren't rules

- The two spawn rows above the well are drawn, faded. The pygame view drew only rows 0–19.
- Sounds are synthesized; the original used NES samples and music.
- The search copies shuffle new bags with their own random numbers, so thinking ahead never
  changes the real game's pieces (the Python shared the global `random`). At depth 0 or 1 the
  search never reaches a refilled bag, so this doesn't change its choices.
- Extra keys (↑, C, Esc/P, A, M) and the touch buttons.
