// The game through the page hook (window.tetris) and real clicks on the page's buttons.
import { test, expect } from "@playwright/test";
import { open, info, stackRows } from "./helpers.mjs";

test("start screen, then Play starts a human game at level 6", async ({ page }) => {
  const errors = await open(page, "?seed=3");
  await expect(page.locator("#menu")).toBeVisible();
  await page.click("#playBtn");
  await expect(page.locator("#menu")).toBeHidden();
  await expect(page.locator("#bar")).toBeVisible();
  const s = await info(page);
  expect(s.screen).toBe("play");
  expect(s.driver).toBe("human");
  expect(s.level).toBe(6);
  await expect(page.locator("#level")).toHaveText("6");
  await expect(page.locator("#score")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("hard drop scores 2 per row and locks; hold swaps in the next piece", async ({ page }) => {
  await open(page, "?seed=5&play=human");
  await page.evaluate(() => tetris.freeze());
  const before = await info(page);
  const r = await page.evaluate(() => {
    const g = tetris.S.game;
    const dy = g.currentPosition.y - g.getGhostPosition().y;
    tetris.step(1, ["HARD"]);
    return { dy, score: g.score };
  });
  expect(r.score).toBe(r.dy * 2);
  const after = await page.evaluate(() => { tetris.step(12, []); return tetris.info(); });
  expect(after.stack.join("").replace(/\./g, "").length).toBe(4);
  expect(after.current.type).toBe(before.next[0]);
  // hold: the current piece goes to hold and the next one comes in
  const h = await page.evaluate(() => { const t = tetris.info().current.type; tetris.step(1, ["HOLD"]); return { t, s: tetris.info() }; });
  expect(h.s.hold).toBe(h.t);
  // can't hold twice before locking
  const again = await page.evaluate(() => { tetris.step(1, []); tetris.step(1, ["HOLD"]); return tetris.info(); });
  expect(again.hold).toBe(h.t);
});

test("pause stops the game; Esc and Resume continue it", async ({ page }) => {
  await open(page, "?seed=7&play=human");
  await page.click("#pauseBtn");
  await expect(page.locator("#pauseCard")).toBeVisible();
  const f1 = (await info(page)).frame;
  await page.waitForTimeout(400);
  expect((await info(page)).frame).toBe(f1);
  await page.click("#resumeBtn");
  await expect(page.locator("#pauseCard")).toBeHidden();
  await page.waitForTimeout(300);
  expect((await info(page)).frame).toBeGreaterThan(f1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pauseCard")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pauseCard")).toBeHidden();
});

test("topping out shows the game over card with the stats; Play again restarts", async ({ page }) => {
  await open(page, "?seed=9&play=human");
  await page.evaluate((grid) => {
    tetris.freeze();
    const st = tetris.state();
    st.grid = grid;
    st.score = 1234;
    tetris.load(st);
    tetris.step(1, ["HARD"]);
    tetris.step(30, []);
    tetris.freeze(false);
  }, stackRows(19));
  await expect(page.locator("#overCard")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#overLevel")).toHaveText("6");
  expect(Number((await page.locator("#overScore").textContent()).replace(/,/g, ""))).toBeGreaterThanOrEqual(1234);
  await page.click("#againBtn");
  await expect(page.locator("#overCard")).toBeHidden();
  const s = await info(page);
  expect(s.dead).toBe(false);
  expect(s.score).toBe(0);
});

test("a line clear scores, counts lines and animates without errors", async ({ page }) => {
  const errors = await open(page, "?seed=11&play=human");
  const r = await page.evaluate(() => {
    tetris.freeze();
    const st = tetris.state();
    // bottom row full except columns 3..6, and an I piece over them
    st.grid[0] = ["S", "S", "S", null, null, null, null, "Z", "Z", "Z"];
    st.current = ["I", 0];
    st.position = { x: 3, y: 19 };
    tetris.load(st);
    const g = tetris.S.game;
    const dy = g.currentPosition.y - g.getGhostPosition().y;
    tetris.step(1, ["HARD"]);
    return { ...tetris.info(), dy };
  });
  expect(r.lines).toBe(1);
  // single at level 6: 100 × 6, plus the combo bonus 50 × 1 × 6, plus 2 per row dropped
  expect(r.score).toBe(600 + 300 + 2 * r.dy);
  await page.evaluate(() => tetris.freeze(false));
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("the AI plays: worker answers, lines get cleared, Take over hands it back", async ({ page }) => {
  const errors = await open(page, "?seed=13");
  await page.click("#watchBtn");
  await expect(page.locator("#aiBadge")).toBeVisible();
  await expect(page.locator("#aiControls")).toBeVisible();
  await expect.poll(async () => (await info(page)).lines, { timeout: 20000 }).toBeGreaterThan(4);
  const s = await info(page);
  expect(s.driver).toBe("ai");
  expect(s.aiPieces).toBeGreaterThan(10);
  await page.click("#aiBtn");
  expect((await info(page)).driver).toBe("human");
  await expect(page.locator("#aiBtnLabel")).toHaveText("Let the AI play");
  await expect(page.locator("#keys")).toBeVisible();
  // and back with the keyboard
  await page.keyboard.press("a");
  expect((await info(page)).driver).toBe("ai");
  expect(errors).toEqual([]);
});

test("the worker's search matches the in-page search on the same state", async ({ page }) => {
  await open(page, "?seed=17&play=human");
  const r = await page.evaluate(async () => {
    tetris.freeze();
    const { HighLevelAIGame, chooseActionDetailed } = await import("./src/ai.mjs");
    const { Game } = await import("./src/game.mjs");
    const st = tetris.state();
    const local = chooseActionDetailed(new HighLevelAIGame(Game.fromJSON(st)), 1);
    const w = new Worker(new URL("./src/ai-worker.mjs", location.href), { type: "module" });
    const reply = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage({ id: 1, state: st, depth: 1 }); });
    w.terminate();
    return { local: local.values, worker: reply.values, best: Math.max(...local.values), chosen: reply.values[reply.index] };
  });
  expect(r.worker).toEqual(r.local);
  expect(r.chosen).toBe(r.best);
});

test("AI controls: speed slider, level (gravity) and lookahead", async ({ page }) => {
  await open(page, "?seed=19&play=ai");
  await page.locator("#speed").fill("100");
  expect((await info(page)).fps).toBe(6000);
  await expect(page.locator("#speedVal")).toHaveText("6.0k/s");
  await page.locator("#speed").fill("0");
  expect((await info(page)).fps).toBe(6);
  for (let i = 0; i < 14; i++) await page.click("#levelUp");
  expect((await info(page)).level).toBe(20);
  await expect(page.locator("#gravVal")).toContainText("G");
  await page.click("#levelDown");
  expect((await info(page)).level).toBe(19);
  await page.click('#depthSeg button[data-depth="0"]');
  expect((await info(page)).depth).toBe(0);
  await expect(page.locator('#depthSeg button[data-depth="0"]')).toHaveClass(/is-on/);
});

test("superhuman gravity: the AI keeps clearing lines at level 18 (a row per frame), 6000 frames/s", async ({ page }) => {
  const errors = await open(page, "?seed=23&play=ai");
  await page.evaluate(() => { tetris.setLevel(18); tetris.setFps(6000); tetris.setDepth(0); });
  const g = await page.evaluate(() => 1 / tetris.S.game.getGravity());
  expect(g).toBeGreaterThan(0.9); // rows per frame
  // headless runs from level 18 at depth 0 last 270 to 630 lines before topping out
  await expect.poll(async () => (await info(page)).lines, { timeout: 25000 }).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test("about modal: opens from ?, both diagrams draw, Esc closes", async ({ page }) => {
  const errors = await open(page, "?seed=29&play=ai");
  await page.click("#aboutBtn");
  await expect(page.locator(".cohesion-about")).toBeVisible();
  await expect(page.locator("#pauseCard")).toBeVisible(); // opening it paused the game
  await page.waitForTimeout(700);
  for (const id of ["#aboutMoves", "#aboutScore"]) {
    const lit = await page.locator(id).evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
      return n;
    });
    expect(lit).toBeGreaterThan(1000);
  }
  await expect(page.locator("#aboutMovesCap")).toContainText("frames of input");
  await expect(page.locator("#aboutScoreCap")).toContainText("Board");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cohesion-about")).toBeHidden();
  expect(errors).toEqual([]);
});

test("menu from pause goes back to the start screen with the AI demo running", async ({ page }) => {
  await open(page, "?seed=31&play=human");
  await page.click("#pauseBtn");
  await page.click("#menuBtn");
  await expect(page.locator("#menu")).toBeVisible();
  const f = (await info(page)).frame;
  await page.waitForTimeout(500);
  expect((await info(page)).frame).toBeGreaterThan(f);
});
