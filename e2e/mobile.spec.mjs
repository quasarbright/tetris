// A 375×812 touch phone: the layout in every state, and the on-screen buttons with real taps.
import { test, expect } from "@playwright/test";
import { open, info, overlaps, stackRows } from "./helpers.mjs";

async function wellRect(page) {
  const L = await page.evaluate(() => tetris.layout());
  // the well plus the two faded spawn rows above it, and the side column
  return { x: L.wellX - 4, y: L.wellY - 2 * L.cell, width: L.nextBox.x + L.nextBox.w - L.wellX + 4, height: L.wellH + 2 * L.cell + 4 };
}

async function checkNoOverlap(page, ids) {
  const well = await wellRect(page);
  expect(well.x).toBeGreaterThanOrEqual(0);
  expect(well.x + well.width).toBeLessThanOrEqual(375);
  for (const id of ids) {
    const box = await page.locator(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(overlaps(box, well), `${id} overlaps the well`).toBe(false);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375.5);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
  }
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(375);
}

test("start screen fits", async ({ page }) => {
  const errors = await open(page, "?seed=61");
  for (const id of ["#playBtn", "#watchBtn"]) {
    const b = await page.locator(id).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
    expect(b.y + b.height).toBeLessThanOrEqual(812 - 30);
  }
  await expect(page.locator("#playSub")).toHaveText("on-screen buttons");
  expect(errors).toEqual([]);
});

test("human play: pad and bar clear of the well, cell size usable", async ({ page }) => {
  await open(page, "?seed=63&play=human");
  await expect(page.locator("#pad")).toBeVisible();
  await expect(page.locator("#dock")).toBeHidden();
  await checkNoOverlap(page, [".tx-score", "#pauseBtn", "#aiTopBtn", "#pad"]);
  expect((await page.evaluate(() => tetris.layout())).cell).toBeGreaterThanOrEqual(20);
  for (const b of await page.locator("#pad button").all()) {
    const r = await b.boundingBox();
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44); // touch target
  }
});

test("AI play: the dock replaces the pad, clear of the well", async ({ page }) => {
  await open(page, "?seed=65&play=ai");
  await expect(page.locator("#dock")).toBeVisible();
  await expect(page.locator("#pad")).toBeHidden();
  await expect(page.locator("#aiBadge")).toBeVisible();
  await checkNoOverlap(page, [".tx-score", "#pauseBtn", "#dock", "#aiBadge"]);
});

test("pause and game over cards fit the screen", async ({ page }) => {
  await open(page, "?seed=67&play=human");
  await page.tap("#pauseBtn");
  const card = await page.locator("#pauseCard .tx-card").boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(375);
  await page.tap("#resumeBtn");
  await page.evaluate((grid) => { const st = tetris.state(); st.grid = grid; tetris.load(st); }, stackRows(19));
  await page.tap('[data-input="HARD"]');
  await expect(page.locator("#overCard")).toBeVisible({ timeout: 6000 });
  const over = await page.locator("#overCard .tx-card").boundingBox();
  expect(over.y).toBeGreaterThanOrEqual(0);
  expect(over.y + over.height).toBeLessThanOrEqual(812);
  expect(over.x + over.width).toBeLessThanOrEqual(375);
});

test("touch buttons: tap moves, rotates, holds and drops; holding a button auto-repeats", async ({ page }) => {
  await open(page, "?seed=69&play=human");
  await page.evaluate(() => {
    const st = tetris.state();
    st.current = ["T", 0]; st.position = { x: 3, y: 19 }; st.level = 1;
    tetris.load(st);
  });
  await page.tap('[data-input="RIGHT"]');
  await page.waitForTimeout(60);
  expect((await info(page)).current.x).toBe(4);
  await page.tap('[data-input="RCW"]');
  await page.waitForTimeout(60);
  expect((await info(page)).current.index).toBe(1);
  await page.tap('[data-input="RCCW"]');
  await page.waitForTimeout(60);
  expect((await info(page)).current.index).toBe(0);
  // press and hold left (touch events don't hold, so hold the pointer the way a finger does)
  const left = await page.locator('[data-input="LEFT"]').boundingBox();
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  expect((await info(page)).current.x).toBe(0);
  await page.tap('[data-input="HOLD"]');
  await page.waitForTimeout(60);
  expect((await info(page)).hold).toBe("T");
  await page.tap('[data-input="HARD"]');
  await page.waitForTimeout(60);
  expect((await info(page)).stack.join("").replace(/\./g, "").length).toBe(4);
});

test("the robot button hands the game to the AI; Take over brings the pad back", async ({ page }) => {
  await open(page, "?seed=71&play=human");
  await page.tap("#aiTopBtn");
  expect((await info(page)).driver).toBe("ai");
  await expect(page.locator("#dock")).toBeVisible();
  await page.tap("#aiBtn");
  expect((await info(page)).driver).toBe("human");
  await expect(page.locator("#pad")).toBeVisible();
});
