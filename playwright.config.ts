import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const externalUrl = process.env.PLAYWRIGHT_BASE_URL;
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => existsSync(path));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    locale:'es-UY',
    baseURL: externalUrl ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: executable, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
  projects: [{ name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },{name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
  webServer: externalUrl ? undefined : {
    command: 'npm run dev -- --port 5173 --strictPort',
    env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:'',VITE_SUPABASE_ANON_KEY:'',VITE_AD_PROVIDER:'none',VITE_SERVER_ECONOMY_ENABLED:'false',VITE_SERVER_RANKINGS_ENABLED:'false'},
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
