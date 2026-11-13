"""Runs the original Python TetrisAI code (vendored, unmodified, in parity/python/) on cases
read as JSON from stdin, and prints the results as JSON. test/parity.test.mjs generates the
cases, runs the same ones through the JS port, and compares.

Case kinds:
  frames   - a state plus a list of frames of held inputs; returns the state after each frame
  gravity  - a level and soft-drop flag; returns Game.getGravity()
  features - a state; returns AIGame.heuristicScore() with prevLines/lines given
  moves    - a state; returns HighLevelAIGame.move(a) for every legal action (the placement,
             the line clears, the score) and generateInputs(a)
  search   - a state and depth; returns minimax's value for every action, in getLegalActions order
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "python"))

import builtins  # noqa: E402
from game import Game  # noqa: E402
from tetrimino import Tetrimino  # noqa: E402
from vector import Vector  # noqa: E402
from aiGame import AIGame, HighLevelAIGame  # noqa: E402
import minimax  # noqa: E402

SCALARS = [
    "frameCount", "lockTime", "shiftTime", "spawnWaitTime", "timeSinceDrop", "canHold", "isSoftDropping",
    "softDropCount", "rotateReleased", "hardReleased", "spawnRequired", "dead", "score", "totalLinesCleared",
    "level", "linesThisLevel", "comboCount", "lastClearDifficult", "tspinPending",
]


def tet(pair):
    return None if pair is None else Tetrimino(pair[0], pair[1])


def load(o):
    g = Game()
    for k in SCALARS:
        if k in o:
            setattr(g, k, o[k])
    g.grid = [list(row) for row in o["grid"]]
    while len(g.grid) < g.height:
        g.grid.append([None] * g.width)
    g.bag = [tet(p) for p in o["bag"]]
    g.currentTetrimino = tet(o["current"])
    g.holdTetrimino = tet(o["hold"])
    g.currentPosition = Vector(o["position"]["x"], o["position"]["y"])
    return g


def dump(g):
    out = {k: getattr(g, k) for k in SCALARS}
    # numbers that are whole floats in Python (score after b2b) compare equal in JSON anyway
    out["grid"] = [list(row) for row in g.grid]
    out["bag"] = [[t.pieceType, t.index] for t in g.bag]
    out["current"] = None if g.currentTetrimino is None else [g.currentTetrimino.pieceType, g.currentTetrimino.index]
    out["hold"] = None if g.holdTetrimino is None else [g.holdTetrimino.pieceType, g.holdTetrimino.index]
    out["position"] = {"x": g.currentPosition.x, "y": g.currentPosition.y}
    return out


def run_frames(case):
    g = load(case["state"])
    states = []
    for frame in case["frames"]:
        if g.dead:
            break
        g.update(frame)
        states.append(dump(g))
    return states


def run_gravity(case):
    g = Game()
    g.level = case["level"]
    g.isSoftDropping = case["soft"]
    return g.getGravity()


def run_features(case):
    ai = AIGame(load(case["state"]))
    ai.prevLines = case["prevLines"]
    ai.lines = case["lines"]
    return ai.heuristicScore()


def run_moves(case):
    ai = HighLevelAIGame(load(case["state"]))
    out = []
    for action in ai.getLegalActions():
        inputs = ai.generateInputs(action)
        after = ai.move(action)
        out.append({
            "inputs": inputs,
            "state": dump(after.game),
            "lines": after.lines,
            "prevLines": after.prevLines,
            "heuristic": after.heuristicScore(),
        })
    return out


def run_search(case):
    ai = HighLevelAIGame(load(case["state"]))
    recorded = {}

    def recording_max(items, key=None):
        if key is None:  # the max over child values inside value()
            return builtins.max(items)
        # minimax.chooseAction ends with max(actions, key=valueOfAction); record every value
        for a in items:
            recorded[a] = key(a)
        return builtins.max(items, key=lambda a: recorded[a])

    minimax.max = recording_max  # shadows the builtin inside the minimax module only
    try:
        chosen = minimax.chooseAction(ai, maxDepth=case["depth"])
    finally:
        del minimax.max
    return {"values": [recorded[a] for a in ai.getLegalActions()], "chosen": list(chosen)}


RUNNERS = {"frames": run_frames, "gravity": run_gravity, "features": run_features, "moves": run_moves,
           "search": run_search}


def main():
    random.seed(0)
    cases = json.load(sys.stdin)
    results = [RUNNERS[c["kind"]](c) for c in cases]
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
