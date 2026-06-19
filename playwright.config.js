import { defineConfig } from '@playwright/test'
import { existsSync } from 'fs'

const customLibPath = '/tmp/glib-noble/usr/lib/x86_64-linux-gnu'
const launchEnv = existsSync(customLibPath)
  ? { LD_LIBRARY_PATH: customLibPath + ':/tmp/playwright-libs/usr/lib/x86_64-linux-gnu' }
  : undefined

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    launchOptions: launchEnv ? { env: { ...process.env, ...launchEnv } } : undefined,
  },
  webServer: {
    command: 'uvicorn test_server.main:app --host 127.0.0.1 --port 8765',
    port: 8765,
    reuseExistingServer: !process.env.CI,
  },
})
