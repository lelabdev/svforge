import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import svforgeAddon from '../packages/svforge/src/index';
import {
	DRIZZLE_ADD_SPEC,
	BETTER_AUTH_ADD_SPEC,
	missingOfficialIntegrations,
	officialIntegrationsRequiredMessage
} from '../packages/svforge/src/official-integrations';
import { PARAGLIDE_ADD_SPEC } from '../packages/svforge/src/i18n';
import { OFFICIAL_FOUNDATION_FILES } from './helpers/official-foundation';

/**
 * #547 phase C — a direct `sv add svforge=…` must never run without the
 * official Paraglide/Drizzle/Better Auth output. The preflight fails closed
 * BEFORE any write and states the supported manual sequence.
 */
const fullProject = (): Map<string, string> => {
	const files = new Map<string, string>(Object.entries(OFFICIAL_FOUNDATION_FILES));
	files.set('project.inlang/settings.json', '{"baseLocale":"fr","locales":["fr","en"]}');
	files.set('src/hooks.ts', "export const reroute = (request) => request.url.pathname;");
	return files;
};

const inspect = (files: Map<string, string>) => ({
	exists: (path: string) => files.has(path),
	read: (path: string) => files.get(path) ?? ''
});

describe('official-integration preflight (#547 phase C)', () => {
	it('reports every missing artifact on an empty project', () => {
		const missing = missingOfficialIntegrations('', 'base', inspect(new Map()));
		expect(missing).toEqual(['project.inlang/settings.json', 'src/hooks.server.ts', 'src/hooks.ts']);
		const dashboard = missingOfficialIntegrations('', 'dashboard', inspect(new Map()));
		expect(dashboard).toEqual(
			expect.arrayContaining(['src/lib/server/auth.ts', 'src/lib/server/db/index.ts', 'src/env.ts'])
		);
	});

	it('accepts the complete official output for both templates', () => {
		const files = fullProject();
		expect(missingOfficialIntegrations('', 'base', inspect(files))).toEqual([]);
		expect(missingOfficialIntegrations('', 'dashboard', inspect(files))).toEqual([]);
	});

	it('base needs only Paraglide; dashboard additionally needs auth/DB', () => {
		const files = new Map<string, string>();
		for (const path of ['project.inlang/settings.json', 'src/hooks.server.ts', 'src/hooks.ts']) {
			files.set(path, fullProject().get(path) ?? '');
		}
		expect(missingOfficialIntegrations('', 'base', inspect(files))).toEqual([]);
		expect(missingOfficialIntegrations('', 'dashboard', inspect(files))).toEqual([
			'src/lib/server/auth.ts',
			'src/lib/server/db/index.ts',
			'src/env.ts'
		]);
	});

	it('detects a hooks file that lacks the official handles', () => {
		const files = fullProject();
		files.set('src/hooks.server.ts', 'export const handle = async ({ resolve }) => resolve();');
		expect(missingOfficialIntegrations('', 'base', inspect(files))).toEqual([
			'src/hooks.server.ts (paraglide handle)'
		]);
		expect(missingOfficialIntegrations('', 'dashboard', inspect(files))).toEqual([
			'src/hooks.server.ts (paraglide handle)',
			'src/hooks.server.ts (better-auth handler)'
		]);
	});

	it('states the exact supported sequence, package-manager aware', () => {
		const base = officialIntegrationsRequiredMessage('base', 'bun@1.3.0');
		expect(base).toContain(`bunx sv add "${PARAGLIDE_ADD_SPEC}"`);
		expect(base).toContain('npx svforge create <dir> --template base --pm bun');
		expect(base).toContain('Nothing was written');

		const dashboard = officialIntegrationsRequiredMessage('dashboard', 'pnpm@9');
		expect(dashboard).toContain(`pnpm dlx sv add "${PARAGLIDE_ADD_SPEC}"`);
		expect(dashboard).toContain(`pnpm dlx sv add "${DRIZZLE_ADD_SPEC}"`);
		expect(dashboard).toContain(`pnpm dlx sv add "${BETTER_AUTH_ADD_SPEC}"`);
		expect(dashboard).toContain('--template dashboard');
	});

	it('cancels the add-on before writing any file', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-direct-'));
		try {
			writeFileSync(join(dir, 'package.json'), '{"name":"app","imports":{}}');
			const writes: string[] = [];
			const dependencies: string[] = [];
			const messages: string[] = [];
			const sv = {
				dependency: (name: string) => dependencies.push(name),
				devDependency: (name: string) => dependencies.push(name),
				file: (path: string) => writes.push(path)
			};
			await svforgeAddon.run({
				sv: sv as never,
				cwd: dir,
				packageManager: 'bun',
				cancel: (message: string) => messages.push(message),
				options: { template: 'dashboard', testing: 'vitest', hooks: 'none' },
				dependencyVersion: () => undefined,
				language: 'ts',
				isKit: true,
				directory: { src: 'src', lib: 'src/lib', kitRoutes: 'src/routes' },
				file: {
					viteConfig: 'vite.config.ts',
					typeConfig: 'tsconfig.json',
					stylesheet: 'src/routes/layout.css',
					package: 'package.json',
					gitignore: '.gitignore',
					getRelative: ({ to }: { to: string }) => to,
					findUp: (filename: string) => filename
				}
			} as never);

			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain('requires them to run first');
			expect(messages[0]).toContain('Nothing was written');
			// Fail closed: no file write, no dependency change.
			expect(writes).toEqual([]);
			expect(dependencies).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
