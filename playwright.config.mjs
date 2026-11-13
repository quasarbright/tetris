// Browser tests (e2e/*.spec.mjs) against the page served from this folder.
//   desktop specs: Chromium and Firefox at 1200×800
//   mobile.spec:   Chromium as a 375×812 touch phone
// Run: npm run test:e2e  (unit + parity: npm run test:unit)
import { defineConfig, devices } from "@playwright/test";

const PORT = 8981;
const desktop = { viewport: { width: 1200, height: 800 } };
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  reporter: [["list"]],
  timeout: 45_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", testIgnore: "mobile.spec.mjs", use: { ...devices["Desktop Chrome"], ...desktop } },
    { name: "firefox", testIgnore: "mobile.spec.mjs", use: { ...devices["Desktop Firefox"], ...desktop } },
    {
      name: "mobile", testMatch: "mobile.spec.mjs",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    // never reuse: a stray server on this port (another project) would get tested instead
    reuseExistingServer: false,
    stderr: "ignore",
  },
});
