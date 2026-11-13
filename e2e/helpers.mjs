// Shared setup for the browser tests: open the page, fail on page errors, wait for the hook.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// The page loads the shared cohesion library from the network. Fetch it once into a disk cache
// (later runs work offline and a slow CDN can't stall a test) and skip web fonts.
const CACHE = join(import.meta.dirname, "..", "node_modules", ".cache", "tetris-e2e");
mkdirSync(CACHE, { recursive: true });
async function serveFromCache(route) {
  const url = route.request().url();
  if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.abort();
  const file = join(CACHE, createHash("sha1").update(url).digest("hex"));
  if (existsSync(file)) {
    const { status, headers, body } = JSON.parse(readFileSync(file, "utf8"));
    return route.fulfill({ status, headers, body: Buffer.from(body, "base64") });
  }
  const res = await route.fetch();
  const body = await res.body();
  const headers = { "content-type": res.headers()["content-type"] || "application/octet-stream", "access-control-allow-origin": "*" };
  if (res.ok()) writeFileSync(file, JSON.stringify({ status: res.status(), headers, body: body.toString("base64") }));
  return route.fulfill({ status: res.status(), headers, body });
}

export async function open(page, query = "") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|NS_ERROR|downloadable font/i.test(m.text())) errors.push(m.text()); });
  await page.route((url) => url.hostname !== "localhost", serveFromCache);
  await page.goto(`/index.html${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.tetris && !!window.tetris.layout());
  return errors;
}

export const info = (page) => page.evaluate(() => window.tetris.info());

// a state with the stack filled to `height` rows (one gap per row, so nothing clears)
export function stackRows(height, gapCol = 0) {
  const rows = [];
  for (let y = 0; y < 40; y++) rows.push(Array.from({ length: 10 }, (_, x) => (y < height && x !== (gapCol + y) % 10 ? "L" : null)));
  return rows;
}

// rects overlap (with a pixel of slack)
export function overlaps(a, b) {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}
