import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The installed zod version is injected at build time so the consumer smoke test
// can prove the runtime serves the app's own pin, not the builder's (#689).
const zodVersion: string = JSON.parse(
	readFileSync(new URL('./node_modules/zod/package.json', import.meta.url), 'utf8')
).version;

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() })],
	define: { __ZOD_VERSION__: JSON.stringify(zodVersion) }
});
