// The AI's search, off the main thread. Gets a game snapshot, runs minimax.chooseAction on it,
// and sends back the chosen move plus every move's value and landing cells (the page draws the
// best few as outlines while the piece travels).
import { Game } from "./game.mjs";
import { HighLevelAIGame, chooseActionDetailed } from "./ai.mjs";

self.onmessage = (e) => {
  const { id, state, depth } = e.data;
  const t0 = performance.now();
  const ai = new HighLevelAIGame(Game.fromJSON(state));
  const res = chooseActionDetailed(ai, depth);
  const ms = performance.now() - t0;
  // where each move would put the piece: replay its inputs on a copy and catch the lock
  const landings = res.actions.map((a) => {
    const sim = ai.copy();
    let cells = null;
    sim.game.listener = (name, data) => { if (name === "lock" && !cells) cells = data.cells; };
    for (const inputs of ai.generateInputs(a)) sim.game.update(inputs);
    return cells;
  });
  self.postMessage({ id, action: res.action, index: res.index, values: res.values, landings, nodes: res.nodes, ms });
};
