import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('maintained documentation contracts (#632)', () => {
	it('keeps the published npm README a concise, actionable CLI introduction', () => {
		const landing = read('packages/svforge/README.md');
		const guide = read('packages/svforge/docs/usage-guide.md');
		expect(landing.length).toBeLessThan(3500);
		expect(landing).toContain('npx svforge create my-app --template base');
		expect(landing).toContain('npx svforge create my-dashboard --template dashboard');
		expect(landing).toContain('npx svforge add blog ui_toast');
		expect(landing).toContain('packages/svforge/docs/usage-guide.md');
		expect(landing).not.toContain('SVForge supports `sv` 1.x');
		expect(guide).toContain('<!-- MODULES-TABLE:START -->');
		expect(guide).toContain('<!-- PRESETS-TABLE:START -->');
		expect(guide).toContain('## Project context and checks');
		const generator = read('scripts/gen-modules-table.mjs');
		expect(generator).toContain("join(ROOT, 'packages/svforge/docs/usage-guide.md')");
	});

	it('names the real scheduled ecosystem drift workflow, separate from manual npm canaries', () => {
		const report = read('packages/svforge/docs/sveltekit-compatibility.md');
		const workflow = '.github/workflows/ecosystem-drift.yml';
		expect(existsSync(join(root, workflow))).toBe(true);
		expect(read(workflow)).toContain("cron: '0 6 * * 1'");
		expect(report).toContain(workflow);
		expect(report).not.toContain('canary.yml');
	});

	it('distinguishes the current sv CLI pin from the historical Better Auth composition tests', () => {
		const pin = JSON.parse(read('package.json')).devDependencies.sv as string;
		const upgrade = read('docs/better-auth-upgrades.md');
		const kit = read('packages/svforge/docs/sveltekit-compatibility.md');
		expect(kit).toContain(`sv@${pin}`);
		expect(upgrade).toContain(`sv@${pin}`);
	});

	it('lists all seven vendored brand assets and each delivery URL', () => {
		const doc = read('packages/svforge/brand/README.md');
		const assets = [
			['favicon.ico', '/favicon.ico'],
			['favicon-16x16.png', '/favicon/favicon-16x16.png'],
			['favicon-32x32.png', '/favicon/favicon-32x32.png'],
			['apple-touch-icon.png', '/favicon/apple-touch-icon.png'],
			['android-chrome-192x192.png', '/favicon/android-chrome-192x192.png'],
			['android-chrome-512x512.png', '/favicon/android-chrome-512x512.png'],
			['site.webmanifest', '/site.webmanifest']
		];
		for (const [file, url] of assets) {
			expect(existsSync(join(root, 'packages/svforge/brand', file))).toBe(true);
			expect(doc, file).toContain(`\`${file}\``);
			expect(doc, url).toContain(`\`${url}\``);
			if (file === 'site.webmanifest') {
				expect(read('packages/svforge/templates/base/root/static/site.webmanifest')).toBe(
					read('packages/svforge/brand/site.webmanifest')
				);
			} else {
				expect(existsSync(join(root, 'packages/svforge/templates/base/src/routes', url, '+server.ts'))).toBe(true);
			}
		}
	});

	it('documents safe temporary release-plan cleanup', () => {
		const release = read('docs/RELEASE.md');
		expect(release).not.toContain('/tmp/svforge-release-plan.json');
		expect(release).not.toContain('/tmp/svforge-compat.json');
		expect(release).toContain("trap 'rm -f \"$RELEASE_PLAN\"' EXIT");
	});
});
