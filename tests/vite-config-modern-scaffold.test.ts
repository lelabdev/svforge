import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * REAL-GENERATION regression for #415.
 *
 * `sv@1.1` creates a Kit 3 project with config options inside
 * `sveltekit({ ... })` in `vite.config.ts`; Kit 3 no longer defines `$lib` by
 * default. A hardcoded fixture can silently drift from that shape, so this
 * scaffolds a REAL project, applies SVForge through the real CLI (`file:`
 * add-on), and validates the generated alias/config.
 *
 * `--no-install` keeps it fast and hermetic: `sv create`/`sv add` copy files
 * without resolving dependencies, and the config is validated by PARSING it.
 */
const ROOT = process.cwd();
const SV_VERSION = '1.1.0';
const SVFORGE = `file:${join(ROOT, 'packages', 'svforge')}`;
const DND = `file:${join(ROOT, 'packages', 'dnd')}`;

function runSv(args: string[], cwd: string): void {
	execFileSync('npm', ['exec', '--yes', '--package', `sv@${SV_VERSION}`, '--', 'sv', ...args], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function ensureBuilt(pkg: string): void {
	const dir = join(ROOT, 'packages', pkg);
	if (!existsSync(join(dir, 'dist', 'index.js'))) {
		execFileSync('bun', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
	}
}

/** Generate a real modern project and apply SVForge through the real CLI. */
function realScaffold(template: string): { root: string; app: string } {
	const root = mkdtempSync(join(tmpdir(), `sf415-${template}-`));
	runSv(
		['create', 'app', '--template', 'minimal', '--types', 'ts', '--no-install', '--no-add-ons', '--no-download-check'],
		root
	);
	const app = join(root, 'app');
	runSv(['add', `${SVFORGE}=template:${template}+testing:vitest+hooks:none`, '--no-install', '--no-download-check'], app);
	return { root, app };
}

async function syntaxErrors(source: string, fileName: string): Promise<string[]> {
	const ts = await import('typescript');
	const { diagnostics } = ts.transpileModule(source, { fileName, reportDiagnostics: true });
	return (diagnostics ?? [])
		.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
		.map((diagnostic) => String(diagnostic.messageText));
}

describe('modern sv layout generates a valid vite.config.ts (#415)', () => {
	beforeAll(() => {
		ensureBuilt('svforge');
		ensureBuilt('dnd');
	}, 120_000);

	for (const template of ['base', 'dashboard']) {
		it(`generates a loadable config for the real ${template} template`, async () => {
			const { root, app } = realScaffold(template);
			try {
				const config = readFileSync(join(app, 'vite.config.ts'), 'utf8');
				// The path-separator regex is byte-identical…
				expect(config).toContain('filename.split(/[/\\\\]/)');
				// …no literal newline landed inside the character class…
				expect(config).not.toMatch(/split\(\/\[\/\\\\\n/);
				// …and SVForge wired its plugins into the generated config.
				expect(config).toContain('svforgeDesignSystemPlugin()');
				expect(config).toContain('paraglideVitePlugin({');
				expect(config).toContain("alias: { $lib: 'src/lib' }");
				// The result PARSES (a broken regex is an unterminated literal).
				expect(await syntaxErrors(config, 'vite.config.ts')).toEqual([]);

			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}, 120_000);
	}

	it('composes the official Tailwind add-on after SVForge without duplicate base wiring', async () => {
		const { root, app } = realScaffold('base');
		try {
			runSv(['add', 'tailwindcss=plugins:none', '--no-install', '--no-download-check', '--no-git-check'], app);
			const config = readFileSync(join(app, 'vite.config.ts'), 'utf8');
			const stylesheet = readFileSync(join(app, 'src/routes/layout.css'), 'utf8');

			expect(config.match(/tailwindcss\(\)/g)).toHaveLength(1);
			expect(config.match(/svforgeDesignSystemPlugin\(\)/g)).toHaveLength(1);
			expect(config.match(/paraglideVitePlugin\(\{/g)).toHaveLength(1);
			expect(config).toContain('sveltekit({');
			expect(stylesheet.match(/@import 'tailwindcss';/g)).toHaveLength(1);
			expect(stylesheet).toContain("@import '@skeletonlabs/skeleton';");
			expect(await syntaxErrors(config, 'vite.config.ts')).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);

	it('keeps the config byte-identical when DnD is added and re-added', () => {
		const { root, app } = realScaffold('base');
		try {
			const before = readFileSync(join(app, 'vite.config.ts'), 'utf8');
			runSv(['add', DND, '--no-install', '--no-download-check'], app);
			expect(readFileSync(join(app, 'vite.config.ts'), 'utf8')).toBe(before);
			runSv(['add', DND, '--no-install', '--no-download-check'], app);
			expect(readFileSync(join(app, 'vite.config.ts'), 'utf8')).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
});
