import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import { baseFiles, baseRootFiles, dashboardFiles, dashboardRootFiles } from '../packages/svforge/src/templates';
import { seedOfficialFoundationOnDisk } from './helpers/official-foundation';
import { ROOT } from './helpers';

/**
 * #674 — Dashboard must be the canonical Base scaffold + additive Dashboard
 * capabilities, not a second hand-maintained copy of Base.
 *
 * This is the deterministic audit the issue asks for: it renders both modes
 * into temp projects, then fails on any UNEXPLAINED difference between shared
 * artifacts or shared dependency versions. Every allowed difference is listed
 * below with its owner, so the list can only change deliberately.
 */

const DOC = join(ROOT, 'packages/svforge/docs/dashboard-composition.md');

/** Shared files Dashboard is allowed to deliver differently, and why. */
const SHARED_OVERRIDES: Record<string, string> = {
	'.svforge-versions.json': 'Upgrade baseline: records what THIS mode delivered (#327).',
	'.svforge.json': 'Project manifest: template and module list differ by mode.',
	'AGENTS.md': 'Mode-specific agent guidance (Dashboard adds auth/DB contracts).',
	'llms.txt': 'Mode-specific component/pattern map.',
	'package.json': 'Dashboard adds its own scripts and dependencies (auth, DB, setup).',
	'src/app.d.ts': 'Official Better Auth add-on owns the App namespace (#547).',
	'src/lib/components/svforge/ui/index.ts': 'Dashboard barrel re-exports its extra components (additive).',
	'src/lib/icons/core.ts': 'Dashboard icon barrel adds admin icons (additive).',
	'src/routes/+layout.svelte': 'Dashboard root layout replaces the Base navbar/footer shell.',
	'src/routes/+layout.ts': 'Dashboard disables prerendering (#439).',
	'vitest.config.ts': 'Dashboard test config: sequential DB execution at the project root (#186).'
};

/**
 * Shared dependency versions that still diverge between the two modes.
 * Phase 3 of #674 removes them: the audit fails as soon as this list and the
 * real divergence map disagree, so a fix cannot land without updating it.
 */
const KNOWN_VERSION_DIVERGENCES: Record<string, { base: string; dashboard: string; reason: string }> = {
	vitest: {
		base: '^5.0.0',
		dashboard: '^4.1.5',
		reason: 'Dashboard (and the uploads testpack) still pin Vitest 4; harmonisation needs its DB tests validated on the Base version (#674 phase 3).'
	}
};

type Declared = { deps: Record<string, string>; devDeps: Record<string, string> };

/** `sv` stand-in: writes files like the real engine and RECORDS dependencies. */
function svWithDeclarations(root: string) {
	const declared: Declared = { deps: {}, devDeps: {} };
	const sv = {
		root,
		dependency: (name: string, version: string) => {
			declared.deps[name] = version;
		},
		devDependency: (name: string, version: string) => {
			declared.devDeps[name] = version;
		},
		file: (path: string, transform: (content: string) => string) => {
			const destination = join(root, path);
			mkdirSync(dirname(destination), { recursive: true });
			let current: string;
			try {
				current = readFileSync(destination, 'utf8');
			} catch {
				current = path === 'package.json' ? '{"scripts":{}}' : '';
			}
			const edited = transform(current);
			if (edited === '') return;
			writeFileSync(destination, edited);
		}
	};
	return { declared, sv: sv as unknown as Parameters<typeof applyBaseMode>[0] };
}

function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry === '.svelte-kit') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full, base));
		else out.push(full.slice(base.length + 1));
	}
	return out;
}

function renderBothModes() {
	const baseDir = mkdtempSync(join(tmpdir(), 'sf-674-base-'));
	const dashDir = mkdtempSync(join(tmpdir(), 'sf-674-dash-'));
	try {
		const base = svWithDeclarations(baseDir);
		applyBaseMode(base.sv, baseFiles, baseRootFiles);

		seedOfficialFoundationOnDisk(dashDir);
		const officialOwned = {
			appTypes: readFileSync(join(dashDir, 'src/app.d.ts'), 'utf8'),
			hooks: readFileSync(join(dashDir, 'src/hooks.server.ts'), 'utf8')
		};
		const dash = svWithDeclarations(dashDir);
		// Exactly the production path since #674 phase 2: the Dashboard mode
		// performs the canonical Base delivery itself, then its own overlay.
		applyDashboardMode(dash.sv, baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

		const basePaths = walk(baseDir);
		const dashPaths = new Set(walk(dashDir));
		const missing = basePaths.filter((path) => !dashPaths.has(path));
		const differing = basePaths.filter(
			(path) => dashPaths.has(path) && readFileSync(join(baseDir, path), 'utf8') !== readFileSync(join(dashDir, path), 'utf8')
		);

		const sharedVersions = (): Record<string, { base: string; dashboard: string }> => {
			const out: Record<string, { base: string; dashboard: string }> = {};
			for (const field of ['deps', 'devDeps'] as const) {
				for (const [name, version] of Object.entries(base.declared[field])) {
					const other = dash.declared[field][name];
					if (other !== undefined && other !== version) out[name] = { base: version, dashboard: other };
				}
			}
			return out;
		};

		const tracked = (
			JSON.parse(readFileSync(join(dashDir, '.svforge-versions.json'), 'utf8')) as {
				dashboard: { fileChecksums: Record<string, string> };
			}
		).dashboard.fileChecksums;
		// #674: the upgrade baseline is computed once, from the delivered files.
		// Verify it here — the temp project is removed when this helper returns.
		const trackingViolations = Object.entries(tracked)
			.filter(([path, checksum]) => {
				const absolute = join(dashDir, path);
				if (!existsSync(absolute)) return true;
				return createHash('sha256').update(readFileSync(absolute)).digest('hex') !== checksum;
			})
			.map(([path]) => path);

		return {
			basePaths,
			dashPaths: [...dashPaths],
			missing,
			differing,
			declared: { base: base.declared, dashboard: dash.declared },
			sharedVersions: sharedVersions(),
			officialOwned,
			deliveredHooks: readFileSync(join(dashDir, 'src/hooks.server.ts'), 'utf8'),
			deliveredAppTypes: readFileSync(join(dashDir, 'src/app.d.ts'), 'utf8'),
			tracked,
			trackingViolations
		};
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
		rmSync(dashDir, { recursive: true, force: true });
	}
}

const rendered = renderBothModes();

describe('Dashboard is the Base scaffold plus additive capabilities (#674)', () => {
	it('delivers every Base file', () => {
		expect(rendered.basePaths.length).toBeGreaterThan(50);
		expect(rendered.missing, `Base files missing from Dashboard: ${rendered.missing.join(', ')}`).toEqual([]);
	});

	it('differs from Base only in the documented overrides', () => {
		expect(rendered.differing.sort()).toEqual(Object.keys(SHARED_OVERRIDES).sort());
	});

	it('delivers every Base dependency to Dashboard', () => {
		// The reviewer follow-up on #675: version parity alone would not notice a
		// Base dependency that Dashboard silently stops declaring.
		const baseDeps = { ...rendered.declared.base.deps, ...rendered.declared.base.devDeps };
		const dashDeps = { ...rendered.declared.dashboard.deps, ...rendered.declared.dashboard.devDeps };
		const dropped = Object.keys(baseDeps).filter((name) => dashDeps[name] === undefined);
		expect(dropped, `Base dependencies missing from Dashboard: ${dropped.join(', ')}`).toEqual([]);
	});

	it('keeps one dependency authority for shared packages', () => {
		// The divergence map must match the documented exceptions EXACTLY: a fix
		// (or a new drift) fails here until the list is updated deliberately.
		const expected = Object.fromEntries(
			Object.entries(KNOWN_VERSION_DIVERGENCES).map(([name, entry]) => [
				name,
				{ base: entry.base, dashboard: entry.dashboard }
			])
		);
		expect(rendered.sharedVersions).toEqual(expected);
	});

	it('documents every override and every known divergence', () => {
		const doc = readFileSync(DOC, 'utf-8');
		for (const path of Object.keys(SHARED_OVERRIDES)) {
			expect(doc, `dashboard-composition.md must explain "${path}"`).toContain(path);
		}
		for (const [name, entry] of Object.entries(KNOWN_VERSION_DIVERGENCES)) {
			expect(doc, `dashboard-composition.md must record the ${name} divergence`).toContain(name);
			expect(doc).toContain(entry.reason.split(' ')[0]);
		}
	});

	it('keeps the reference manifests and the uploads testpack honest about their versions', () => {
		const manifest = (template: string) => {
			const path = join(ROOT, `packages/svforge/templates/${template}/package.json`);
			const pkg = JSON.parse(readFileSync(path, 'utf-8')) as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			return { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
		};

		// The hand-maintained template manifests mirror what the composer declares
		// for that mode — otherwise they are a second, silent source of truth.
		const base = manifest('base');
		const dashboard = manifest('dashboard');
		for (const [name, version] of Object.entries(rendered.declared.base.devDeps)) {
			if (base[name] !== undefined) expect(base[name], `templates/base package.json ${name}`).toBe(version);
		}
		for (const [name, version] of Object.entries(rendered.declared.dashboard.devDeps)) {
			if (dashboard[name] !== undefined) expect(dashboard[name], `templates/dashboard package.json ${name}`).toBe(version);
		}

		// The optional uploads testpack must not drag in a different Vitest than
		// the mode it installs into (phase 3 removes the remaining exception).
		const uploads = readFileSync(join(ROOT, 'packages/uploads/src/index.ts'), 'utf-8');
		const match = uploads.match(/devDependency\('vitest',\s*'([^']+)'\)/);
		expect(match, 'uploads testpack declares a Vitest version').not.toBeNull();
		expect(match![1]).toBe(rendered.declared.dashboard.devDeps.vitest);
	});

	it('computes the upgrade baseline once, from the delivered files', () => {
		// The canonical delivery + the Dashboard overlay are recorded in ONE
		// baseline: every tracked path exists and matches its SHA-256.
		expect(Object.keys(rendered.tracked).length).toBeGreaterThan(50);
		expect(rendered.trackingViolations, `stale or missing tracked files: ${rendered.trackingViolations.join(', ')}`).toEqual(
			[]
		);
		// Official-owned files are delivered by the add-ons, never tracked as ours.
		expect(rendered.tracked['src/app.d.ts']).toBeUndefined();
		expect(rendered.tracked['src/hooks.server.ts']).toBeUndefined();
	});

	it('extends the official-owned wiring instead of overwriting it', () => {
		// #547: the official Better Auth/Drizzle add-on owns these files. The
		// Dashboard composition must keep the official contract and only ADD its
		// own policy on top — never re-emit the Base copies.
		expect(rendered.deliveredAppTypes).toBe(rendered.officialOwned.appTypes);
		for (const marker of ['svelteKitHandler', 'auth.api.getSession', 'handleSvforgePolicy', 'paraglideMiddleware']) {
			expect(rendered.deliveredHooks, `hooks.server.ts must keep ${marker}`).toContain(marker);
		}
	});
});
