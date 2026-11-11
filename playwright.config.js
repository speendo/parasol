import { defineConfig } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'

const testDepsLib = join(process.cwd(), 'test-deps/lib')

// Set LD_LIBRARY_PATH in current process so Playwright's headless-shell
// binary can pass its pre-launch runnability check (required by CI parity).
if (existsSync(testDepsLib)) {
  process.env.LD_LIBRARY_PATH = testDepsLib + ':' + (process.env.LD_LIBRARY_PATH || '')
}

export default defineConfig({
  testDir: './tests/e2e',
  // The FastAPI test server mirrors a single device with a global upload lock
  // and broadcasts settings to every connected client. Running test files in
  // parallel would make those shared globals race across files, so run tests
  // sequentially.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:8000',
  },
  webServer: {
    command: 'uvicorn test_server.main:app --host 127.0.0.1 --port 8000',
    port: 8000,
    reuseExistingServer: !process.env.CI,
  },
})
