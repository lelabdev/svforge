import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers';
import { diskSv } from './helpers/fixtures';

/**
 * #325 — favicon delivery; #613 — the REAL SVForge brand icon.
 *
 * prebuild embeds ONLY each template's `src/` and `root/` trees as UTF-8
 * strings (repo AGENTS.md gotcha), so the historical static/favicon.ico never
 * shipped and #325 answered /favicon.ico from a hand-written SVG. That SVG was
 * a placeholder (cyan square + white triangle) — not the brand icon.
 *
 * #613 ships the canonical brand binaries from `packages/svforge/brand/`:
 * prebuild embeds them as base64 in a generated template module and four
 * prerendered routes decode them with the correct Content-Type, so there is
 * exactly ONE source of artwork.
 */
const BRAND_DIR = join(ROOT, 'packages/svforge/brand');
const BRAND_ICONS = {
	FAVICON_ICO: { file: 'favicon.ico', magic: [0x00, 0x00, 0x01, 0x00] },
	FAVICON_32: { file: 'favicon-32x32.png', magic: [0x89, 0x50, 0x4e, 0x47] },
	FAVICON_16: { file: 'favicon-16x16.png', magic: [0x89, 0x50, 0x4e, 0x47] },
	APPLE_TOUCH_ICON: { file: 'apple-touch-icon.png', magic: [0x89, 0x50, 0x4e, 0x47] }
} as const;

const ROUTES = [
	{ path: '/routes/favicon.ico/+server.ts', type: 'image/x-icon' },
	{ path: '/routes/favicon/favicon-32x32.png/+server.ts', type: 'image/png' },
	{ path: '/routes/favicon/favicon-16x16.png/+server.ts', type: 'image/png' },
	{ path: '/routes/favicon/apple-touch-icon.png/+server.ts', type: 'image/png' }
];

const decode = (base64: string) => Buffer.from(base64, 'base64');
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** Read one embedded brand icon straight from the delivered manifest source. */
async function embedded(constant: string): Promise<Buffer> {
	const { baseFiles } = await import('../packages/svforge/src/templates');
	const source = baseFiles['/lib/assets/brand-favicons.ts'] as string;
	const match = source.match(new RegExp(`export const ${constant} = '([^']+)';`));
	if (!match) throw new Error(`${constant} missing from the generated brand-favicons module`);
	return decode(match[1]);
}

describe('SVForge brand favicon (#613)', () => {
	it('ships the canonical brand binaries byte for byte', async () => {
		for (const [constant, { file, magic }] of Object.entries(BRAND_ICONS)) {
			const canonical = readFileSync(join(BRAND_DIR, file));
			const shipped = await embedded(constant);

			// Identity with the canonical asset — the generated module can never
			// drift into a second, hand-maintained artwork.
			expect(sha256(shipped), `${file} differs from packages/svforge/brand/${file}`).toBe(
				sha256(canonical)
			);
			expect([...shipped.subarray(0, magic.length)]).toEqual(magic);
		}
	});

	it('embeds a real ICO and the documented PNG sizes', async () => {
		const ico = await embedded('FAVICON_ICO');
		// ICO header: reserved 0, type 1, and the three frames (16/32/48).
		expect(ico.readUInt16LE(0)).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		expect(ico.readUInt16LE(4)).toBe(3);

		for (const [constant, size] of [
			['FAVICON_32', 32],
			['FAVICON_16', 16],
			['APPLE_TOUCH_ICON', 180]
		] as const) {
			const png = await embedded(constant);
			expect(png.readUInt32BE(16)).toBe(size);
			expect(png.readUInt32BE(20)).toBe(size);
		}
	});

	it('no longer ships the cyan-square/white-triangle placeholder', async () => {
		const { baseFiles, baseRootFiles } = await import('../packages/svforge/src/templates');
		const shipped = [...Object.values(baseFiles), ...Object.values(baseRootFiles)].join('\n');

		expect(baseRootFiles).not.toHaveProperty('/static/favicon.svg');
		expect(shipped).not.toContain('#00abd4');
		// The exact placeholder glyph from the old SVG/route.
		expect(shipped).not.toContain('M16 8.5 23.5 23h-15Z');
	});

	it('declares every brand icon in app.html', async () => {
		const { baseFiles } = await import('../packages/svforge/src/templates');
		const app = baseFiles['/app.html'];

		expect(app).toContain('href="%sveltekit.assets%/favicon.ico"');
		expect(app).toContain('href="%sveltekit.assets%/favicon/favicon-32x32.png"');
		expect(app).toContain('href="%sveltekit.assets%/favicon/favicon-16x16.png"');
		expect(app).toContain('href="%sveltekit.assets%/favicon/apple-touch-icon.png"');
		expect(app).not.toContain('favicon.svg');
	});

	it('delivers prerendered routes with the correct Content-Type to both templates', async () => {
		const { baseFiles } = await import('../packages/svforge/src/templates');
		const { DASHBOARD_RECIPE } = await import('../packages/svforge/src/upgrade');

		for (const { path, type } of ROUTES) {
			for (const [label, files] of [
				['base', baseFiles],
				['dashboard', DASHBOARD_RECIPE.files]
			] as const) {
				const source = files[path as keyof typeof files] as string | undefined;
				expect(source, `${label} must deliver ${path}`).toBeTruthy();
				expect(source).toMatch(/prerender\s*=\s*true/);
				expect(source).toContain(type);
				expect(source).toContain("from '#lib/assets/brand-favicons.js'");
			}
		}
		// One artwork source: the module itself ships with the templates.
		expect(baseFiles['/lib/assets/brand-favicons.ts']).toBeTruthy();
	});

	it('behavioral: base mode writes the brand routes and the embedded artwork', async () => {
		const { applyBaseMode } = await import('../packages/svforge/src/modes/base');
		const { baseFiles } = await import('../packages/svforge/src/templates');
		const dir = mkdtempSync(join(tmpdir(), 'sf-favicon-'));
		try {
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }));
			applyBaseMode(
				diskSv(dir) as never,
				Object.fromEntries(
					Object.entries(baseFiles).filter(
						([path]) => path === '/app.html' || path.includes('favicon') || path.includes('brand-favicons')
					)
				)
			);

			for (const { path } of ROUTES) {
				expect(existsSync(join(dir, 'src', path)), path).toBe(true);
			}
			expect(existsSync(join(dir, 'src/lib/assets/brand-favicons.ts'))).toBe(true);
			const written = readFileSync(join(dir, 'src/lib/assets/brand-favicons.ts'), 'utf8');
			expect(sha256(decode(written.match(/FAVICON_ICO = '([^']+)'/)![1]))).toBe(
				sha256(readFileSync(join(BRAND_DIR, 'favicon.ico')))
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('robots.txt has ONE source: the base root files (dashboard inherits it)', async () => {
		const { baseRootFiles, dashboardRootFiles } = await import('../packages/svforge/src/templates');
		expect(baseRootFiles['/static/robots.txt']).toBeTruthy();
		expect(Object.keys(dashboardRootFiles)).not.toContain('/static/robots.txt');
		expect(baseRootFiles['/static/robots.txt']).toMatch(/User-agent/);
	});
});
