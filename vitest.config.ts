import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	resolve: {
		conditions: ['module', 'browser', 'development|production'],
		alias: {
			// Templates import Paraglide messages via `$lib/paraglide/messages.js`.
			// In repo-root tests we stub that module (tests/stubs/lib/...) instead
			// of requiring a full scaffolded Paraglide build.
			$lib: fileURLToPath(new URL('./tests/stubs/lib', import.meta.url)),
			// Same for `$app/env` (Table's dev-only rowKey warning).
			'$app/env': fileURLToPath(new URL('./tests/stubs/app/environment.ts', import.meta.url)),
			'phosphor-svelte/lib/Bell': fileURLToPath(new URL('./tests/stubs/phosphor-svelte/lib/Bell.svelte', import.meta.url))
		}
	},
	plugins: [
		// Compiles template .svelte components imported by the primitives tests
		// (#321). Only .svelte files are transformed — static template tests are
		// unaffected.
		svelte()
	],
	test: {
		include: ['tests/**/*.test.ts'],
		// Type-level tests for the #321 prop contracts (Button union, Table row
		// generic). Runs under the plain `vitest run` invoked by `bun run test`.
		typecheck: {
			enabled: true,
			tsconfig: './tsconfig.test-d.json',
			include: ['tests/**/*.test-d.ts']
		}
	}
});
