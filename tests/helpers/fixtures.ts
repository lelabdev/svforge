import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Shared project fixtures for addon behavioral tests (#323, #324).
 *
 * `createDashboardProject` simulates a REAL svforge dashboard scaffold on
 * disk (the structural state the capability contract detects), so module
 * `run()` functions can be exercised against a realistic project.
 */

const PARAGLIDE_SCHEMA = 'https://inlang.com/schema/inlang-message-format';

export const VALID_MANIFEST = {
	schema: 1,
	template: 'dashboard',
	stack: {
		framework: 'sveltekit',
		ui: 'skeleton',
		i18n: 'paraglide',
		test: 'vitest',
		auth: 'better-auth',
		orm: 'drizzle',
		database: 'postgresql'
	},
	modules: [] as string[],
	// Canonical capability tokens (#323): a real dashboard scaffold writes the
	// TEMPLATE_PROVIDES grants into the manifest.
	capabilities: ['ui.skeleton', 'ui.svforge', 'i18n.messages', 'auth.currentUser', 'auth.admin', 'database.drizzle.postgres'] as string[],
	patterns: {} as Record<string, string>,
	generatedBy: 'svforge'
};

/**
 * A minimal but REAL dashboard-equivalent project:
 * - package.json carries the dependencies the capability contract detects
 *   (better-auth, drizzle-orm + postgres, paraglide, skeleton)
 * - the svforge-provided files exist (db, admin, svforge UI kit, messages)
 */
export function createDashboardProject(dir: string, options: { messages?: boolean } = {}): void {
	const { messages = true } = options;
	mkdirSync(join(dir, 'src/lib/server/db'), { recursive: true });
	writeFileSync(join(dir, 'src/lib/server/db/index.ts'), 'export const db = {};\n');
	writeFileSync(join(dir, 'src/lib/server/admin.ts'), 'export const isAdmin = () => true;\n');
	mkdirSync(join(dir, 'src/lib/components/svforge/primitives'), { recursive: true });
	mkdirSync(join(dir, 'src/lib/components/svforge/ui'), { recursive: true });
	writeFileSync(join(dir, 'src/lib/components/svforge/primitives/index.ts'), '');
	writeFileSync(join(dir, 'src/lib/components/svforge/ui/index.ts'), '');
	mkdirSync(join(dir, 'src/routes/(app)/admin'), { recursive: true });
	// Real dashboard scaffolds wire auth in hooks.server.ts (Better Auth session
	// → locals.user) and ship drizzle.config.ts at the project root (#187) —
	// the structural signals the external-origin capability detection looks for.
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(
		join(dir, 'src/hooks.server.ts'),
		[
			"import { auth } from '$lib/server/auth';",
			'',
			'export const handle = async ({ event, resolve }) => {',
			'  const session = await auth.api.getSession({ headers: event.request.headers });',
			'  if (session) event.locals.user = session.user;',
			'  return resolve(event);',
			'};',
			''
		].join('\n')
	);
	writeFileSync(
		join(dir, 'drizzle.config.ts'),
		["import { defineConfig } from 'drizzle-kit';", '', 'export default defineConfig({ schema: "./src/lib/server/db/schema.ts" });', ''].join('\n')
	);

	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify(
			{
				name: 'fixture-app',
				type: 'module',
				dependencies: {
					'@inlang/paraglide-js': '^2.24.0',
					'better-auth': '~1.7.4',
					drizzle: '^0.45.2',
					'drizzle-orm': '^0.45.2',
					postgres: '^3.4.5'
				},
				devDependencies: {
					'@skeletonlabs/skeleton': '^5.0.0',
					'@skeletonlabs/skeleton-svelte': '^5.0.0'
				}
			},
			null,
			2
		)
	);

	if (messages) {
		mkdirSync(join(dir, 'messages'), { recursive: true });
		writeFileSync(
			join(dir, 'messages/fr.json'),
			`${JSON.stringify({ $schema: PARAGLIDE_SCHEMA, hello: 'bonjour' }, null, 2)}\n`
		);
		writeFileSync(
			join(dir, 'messages/en.json'),
			`${JSON.stringify({ $schema: PARAGLIDE_SCHEMA, hello: 'hello' }, null, 2)}\n`
		);
	}

	writeFileSync(join(dir, '.svforge.json'), `${JSON.stringify(VALID_MANIFEST, null, 2)}\n`);
	writeFileSync(
		join(dir, 'llms.txt'),
		['# SvelteForge project', '', '## Capabilities installed', '', '## Canonical patterns', ''].join('\n')
	);
}

/** A bare minimal SvelteKit project (sv create minimal): no SVForge state. */
export function createBareProject(dir: string): void {
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'bare-app', type: 'module', dependencies: {} }, null, 2)
	);
	mkdirSync(join(dir, 'src/routes'), { recursive: true });
	writeFileSync(join(dir, 'src/routes/+page.svelte'), '<h1>hi</h1>\n');
}

/**
 * A minimal base-equivalent project: the structural state the svforge base
 * template provides (Skeleton + Paraglide + the svforge UI kit + messages).
 */
export function createBaseProject(dir: string): void {
	mkdirSync(join(dir, 'src/lib/components/svforge/primitives'), { recursive: true });
	mkdirSync(join(dir, 'src/lib/components/svforge/ui'), { recursive: true });
	writeFileSync(join(dir, 'src/lib/components/svforge/primitives/index.ts'), '');
	writeFileSync(join(dir, 'src/lib/components/svforge/ui/index.ts'), '');
	mkdirSync(join(dir, 'src/lib/utils'), { recursive: true });
	writeFileSync(join(dir, 'src/lib/utils/cn.ts'), 'export const cn = (...i: unknown[]) => String(i);\n');
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify(
			{
				name: 'fixture-base-app',
				type: 'module',
				dependencies: { '@inlang/paraglide-js': '^2.24.0' },
				devDependencies: { '@skeletonlabs/skeleton': '^5.0.0' }
			},
			null,
			2
		)
	);
	mkdirSync(join(dir, 'messages'), { recursive: true });
	writeFileSync(
		join(dir, 'messages/fr.json'),
		`${JSON.stringify({ $schema: PARAGLIDE_SCHEMA }, null, 2)}\n`
	);
	writeFileSync(
		join(dir, 'messages/en.json'),
		`${JSON.stringify({ $schema: PARAGLIDE_SCHEMA }, null, 2)}\n`
	);
	writeFileSync(
		join(dir, '.svforge.json'),
		`${JSON.stringify({ ...VALID_MANIFEST, template: 'base', stack: { ...VALID_MANIFEST.stack, auth: undefined, orm: undefined, database: undefined } }, null, 2)}\n`
	);
	writeFileSync(
		join(dir, 'llms.txt'),
		['# SvelteForge project', '', '## Capabilities installed', '', '## Canonical patterns', ''].join('\n')
	);
}

/**
 * Disk-backed fake of the sv addon API with the SAME write semantics as the
 * real engine (node_modules/sv runAddon): sv.file loads the CURRENT file from
 * disk, applies the transform, and saves IMMEDIATELY.
 */
export function diskSv(root: string) {
	const written: string[] = [];
	return {
		written,
		dependency() {},
		devDependency() {},
		file(destPath: string, transform: (content: string) => string) {
			const destination = join(root, destPath);
			const current = existsSync(destination) ? readFileSync(destination, 'utf8') : '';
			const edited = transform(current);
			// The engine also skips falsy results — mirror the '' skip.
			if (edited === '') return;
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, edited);
			written.push(destPath);
		}
	};
}
