import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for the Newisance frontend.
 *
 * Boots the Vite dev server and runs specs against it. Tests stub the
 * `/api/game/*` endpoints with `page.route`, so NO backend service is needed.
 *
 * A tall viewport is used on purpose: the Timed Challenge gap height scales
 * with the canvas height (`gapH = max(birdR*5.6, playH*0.26)`), so a taller
 * window gives the bird a roomier gap — which makes it realistic to steer it
 * cleanly through a gap (and thus exercise the "Checking… → graded" overlay
 * path) without fighting the physics.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 820, height: 1300 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
