import { defineConfig, devices } from '@playwright/test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Layer 5 (deterministic execution) — generic across apps.
 *
 * Projects are DISCOVERED from app-model/<app>/app.json, each paired with
 * tests/<app>/. Adding a new app is "drop app-model/<app>/ + tests/<app>/" —
 * no edit here. Artifacts are captured on failure/retry so the failure-analyzer
 * has real evidence (trace, screenshot, video) to diagnose from.
 */
function discoverApps() {
  const dir = join(ROOT, 'app-model');
  const apps = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const manifest = join(dir, entry.name, 'app.json');
    if (entry.isDirectory() && existsSync(manifest)) {
      const cfg = JSON.parse(readFileSync(manifest, 'utf8'));
      const testDir = join('tests', entry.name);
      if (existsSync(join(ROOT, testDir))) {
        apps.push({ name: cfg.app || entry.name, baseURL: cfg.baseURL, testDir });
      }
    }
  }
  return apps;
}

const apps = discoverApps();

export default defineConfig({
  outputDir: './artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  // One project per discovered app. BASE_URL overrides the first app (handy for POC).
  projects: apps.map((a, i) => ({
    name: a.name,
    testDir: a.testDir,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: i === 0 && process.env.BASE_URL ? process.env.BASE_URL : a.baseURL,
    },
  })),
});
