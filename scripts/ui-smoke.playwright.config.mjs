import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	testMatch: 'ui-browser-smoke.test.mjs',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
		locale: 'en-US',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: 'bun run build && bun run preview -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI
	}
});
