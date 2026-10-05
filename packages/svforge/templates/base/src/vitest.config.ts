import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: { alias: { '$lib': fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts']
	}
});
