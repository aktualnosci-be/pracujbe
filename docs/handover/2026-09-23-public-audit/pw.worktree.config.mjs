// Konfiguracja Playwright dla worktree agentów: PORT i WT z env. Serwer: next start z już zbudowanego .next.
import { defineConfig, devices } from '@playwright/test';
const WT = process.env.WT; const PORT = Number(process.env.PORT);
if (!WT || !PORT) throw new Error('Ustaw WT=/workspace/wt/<nazwa> i PORT');
export default defineConfig({
  testDir: `${WT}/tests/e2e`, fullyParallel: true, workers: 2, retries: 0, reporter: 'line',
  expect: { timeout: 10_000 },
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } }],
  webServer: { command: `npx next start -p ${PORT}`, cwd: WT, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 120_000 },
});
