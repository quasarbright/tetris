// Real keyboard input, in real time, at the game's own 60 frames per second.
import { test, expect } from "@playwright/test";
import { open, info } from "./helpers.mjs";

async function start(page, seed) {
  await open(page, `?seed=${seed}&play=human`);
  // a T, so rotations are visible, at spawn with nothing below it
  await page.evaluate(() => {
    const st = tetris.state();
    st.current = ["T", 0];
    st.position = { x: 3, y: 19 };
    st.level = 1; // slow gravity: about a row a second
    tetris.load(st);
  });
}

test("tap left/right moves one column; holding left auto-repeats to the wall", async ({ page }) => {
  await start(page, 41);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect((await info(page)).current.x).toBe(4);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(60);
  expect((await info(page)).current.x).toBe(3);
  // DAS: 16 frames, then a move every 6 frames: 3 columns to the wall take ~(16 + 12)/60 s
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(200);
  expect((await info(page)).current.x).toBe(2); // only the first move so far
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  expect((await info(page)).current.x).toBe(0);
});

test("X and up rotate clockwise, Z counterclockwise; holding doesn't repeat", async ({ page }) => {
  await start(page, 43);
  await page.keyboard.press("x");
  await page.waitForTimeout(60);
  expect((await info(page)).current.index).toBe(1);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(60);
  expect((await info(page)).current.index).toBe(2);
  await page.keyboard.press("z");
  await page.waitForTimeout(60);
  expect((await info(page)).current.index).toBe(1);
  await page.keyboard.down("z");
  await page.waitForTimeout(300);
  await page.keyboard.up("z");
  expect((await info(page)).current.index).toBe(0);
});

test("space hard drops; down soft drops faster than gravity; shift holds", async ({ page }) => {
  await start(page, 47);
  const y0 = (await info(page)).current.y;
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowDown");
  const y1 = (await info(page)).current.y;
  expect(y0 - y1).toBeGreaterThan(4); // gravity alone at level 1 is ~1 row/s
  expect((await info(page)).score).toBe(0); // soft drop points arrive on lock
  await page.keyboard.press("Space");
  await page.waitForTimeout(80);
  const s = await info(page);
  expect(s.stack.join("").replace(/\./g, "").length).toBe(4);
  expect(s.score).toBeGreaterThan(0);
  await page.waitForTimeout(300); // the next piece spawns
  const t = (await info(page)).current.type;
  await page.keyboard.press("Shift");
  await page.waitForTimeout(80);
  expect((await info(page)).hold).toBe(t);
});

test("the AI button and A key hand the game over and back", async ({ page }) => {
  await start(page, 53);
  await page.click("#aiBtn");
  await expect(page.locator("#aiBtnLabel")).toHaveText("Take over");
  await expect.poll(async () => (await info(page)).aiPieces, { timeout: 10000 }).toBeGreaterThan(2);
  await page.keyboard.press("a");
  expect((await info(page)).driver).toBe("human");
  // keys work again right away. (Put a fresh T at the spawn first: the AI's last hard drop may
  // still be locking and spawning when control comes back, which would move the piece.)
  await page.evaluate(() => {
    const st = tetris.state();
    st.current = ["T", 0]; st.position = { x: 3, y: 19 }; st.level = 1;
    st.spawnRequired = false; st.hardReleased = true; st.shiftTime = 0;
    tetris.load(st);
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect((await info(page)).current.x).toBe(4);
});
