import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	resolveModules,
	readDeclaredProvides,
	type ResolveInput,
	type ResolutionPlan
} from '../packages/addon-kit/src/resolve';

/**
 * Tests for #419 — dependency-aware module installation. The planner is
 * PURE: it derives everything from the canonical registry
 * (MODULE_CONTRACTS) and never mutates anything. Providers are resolved
 * from (in order of evidence): declared external capabilities, structural
 * evidence, the active template, installed modules — then supporting
 * SVForge modules are proposed, transitively and deterministically.
 */

function plan(input: ResolveInput): ResolutionPlan {
	return resolveModules(input);
}

describe('module resolver — providers (#419)', () => {
	it('treats template capabilities as satisfied — no supporting module proposed', () => {
		const result = plan({ requested: ['audit'], template: 'dashboard' });
		expect(result.supporting).toEqual([]);
		expect(result.order).toEqual(['audit']);
		expect(result.errors).toEqual([]);
		expect(result.satisfied.map((s) => `${s.capability}=${s.provider.kind}`)).toContain(
			'auth.currentUser=template'
		);
	});

	it('treats installed-module capabilities as satisfied', () => {
		const result = plan({ requested: ['chat'], installed: ['uploads'], template: 'base' });
		expect(result.supporting).toEqual([]);
		expect(result.satisfied.map((s) => `${s.capability}=${s.provider.kind}:${'moduleId' in s.provider ? s.provider.moduleId : ''}`)).toContain(
			'storage.object=installed:uploads'
		);
	});

	it('never uses the contract `template` field as proof of satisfaction (uploads gotcha)', () => {
		// uploads is marked template:'base' but requires auth.currentUser,
		// which base does NOT provide — the resolver must work from
		// requires/provides: no module provides auth.currentUser, so the plan
		// fails loudly instead of pretending base satisfies it.
		const result = plan({ requested: ['uploads'], template: 'base' });
		expect(result.supporting).toEqual([]);
		expect(result.errors).toEqual([
			{ kind: 'unsatisfiable', capability: 'auth.currentUser', providers: [] }
		]);
		expect(result.order).toEqual([]);
	});

	it('resolves transitively in dependency order', () => {
		const result = plan({ requested: ['jobs'], template: 'base' });
		// jobs needs database.drizzle.postgres — a dashboard-only capability no
		// module provides; on base the plan must fail with that capability.
		expect(result.errors.map((e) => e.capability)).toContain('database.drizzle.postgres');
		// chat additionally needs auth.currentUser — also dashboard-only.
		const chat = plan({ requested: ['chat'], template: 'base' });
		expect(chat.errors.map((e) => e.capability)).toContain('auth.currentUser');
		// ui.svforge however IS provided by base — never an error here.
		expect(chat.errors.map((e) => e.capability)).not.toContain('ui.svforge');
	});

	it('resolves transitive chains between modules', () => {
		// Isolated registry: a requires storage.object (provided by b2) —
		// planner must add b2 first, in dependency order.
		const contracts = {
			a: { template: 'base' as const, requires: ['storage.object' as const], provides: [], optional: [], optionalModules: [] },
			b2: { template: 'base' as const, requires: [], provides: ['storage.object' as const], optional: [], optionalModules: [] }
		};
		const result = plan({ requested: ['a'], contracts });
		expect(result.order).toEqual(['b2', 'a']);
		expect(result.supporting.map((s) => s.moduleId)).toEqual(['b2']);
	});

	it('declared external capabilities are respected and not replaced by a module', () => {
		const result = plan({
			requested: ['uploads'],
			template: 'base',
			declaredProvides: ['auth.currentUser']
		});
		expect(result.supporting).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(result.satisfied.map((s) => `${s.capability}=${s.provider.kind}`)).toContain(
			'auth.currentUser=declared'
		);
	});

	it('structural evidence satisfies capabilities without proposing modules', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-resolver-'));
		try {
			mkdirSync(join(dir, 'src/lib/server'), { recursive: true });
			mkdirSync(join(dir, 'src/lib/components/svforge'), { recursive: true });
			mkdirSync(join(dir, 'messages'), { recursive: true });
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ dependencies: { 'better-auth': '1', 'drizzle-orm': '0', postgres: '3', '@inlang/paraglide-js': '2' } })
			);
			writeFileSync(join(dir, 'drizzle.config.ts'), 'export default {}');
			writeFileSync(
				join(dir, 'src/hooks.server.ts'),
				'export const handle = auth.handler; locals.user = auth.api.getSession'
			);
			writeFileSync(join(dir, 'src/lib/server/admin.ts'), 'export async function isAdmin() {}');
			writeFileSync(join(dir, 'messages/en.json'), '{}');
			writeFileSync(join(dir, 'src/lib/components/svforge/.gitkeep'), '');
			const { snapshotProject } = await import('../packages/addon-kit/src/capabilities');
			const result = plan({
				requested: ['audit'],
				snapshot: snapshotProject(dir)
			});
			expect(result.supporting).toEqual([]);
			expect(result.errors).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('runtime capabilities become attestations — never module installs', () => {
		const result = plan({ requested: ['realtime'] });
		expect(result.runtimeAttestations).toEqual(['runtime.websocket']);
		expect(result.supporting).toEqual([]);
		expect(result.order).toEqual(['realtime']);
	});

	it('flags unknown requested modules', () => {
		const result = plan({ requested: ['nope'] });
		expect(result.unknownModules).toEqual(['nope']);
	});
});

describe('module resolver — failure modes (#419)', () => {
	it('reports ambiguous providers before writing files', () => {
		const contracts = {
			x: { template: 'base' as const, requires: [], provides: ['storage.object' as const], optional: [], optionalModules: [] },
			y: { template: 'base' as const, requires: [], provides: ['storage.object' as const], optional: [], optionalModules: [] },
			z: {
				template: 'base' as const,
				requires: ['storage.object' as const],
				provides: [],
				optional: [],
				optionalModules: []
			}
		};
		const result = plan({ requested: ['z'], contracts, template: 'base' });
		expect(result.errors).toEqual([
			{ kind: 'ambiguous', capability: 'storage.object', providers: ['x', 'y'] }
		]);
	});

	it('lets an injected chooseProvider callback resolve an ambiguity deterministically', () => {
		const contracts = {
			x: { template: 'base' as const, requires: [], provides: ['storage.object' as const], optional: [], optionalModules: [] },
			y: { template: 'base' as const, requires: [], provides: ['storage.object' as const], optional: [], optionalModules: [] },
			z: {
				template: 'base' as const,
				requires: ['storage.object' as const],
				provides: [],
				optional: [],
				optionalModules: []
			}
		};
		const result = plan({
			requested: ['z'],
			contracts,
			template: 'base',
			chooseProvider: (_capability, providers) => providers[1]!
		});
		expect(result.errors).toEqual([]);
		expect(result.supporting.map((s) => s.moduleId)).toEqual(['y']);
	});

	it('detects cycles before writing files', () => {
		const contracts = {
			p1: {
				template: 'base' as const,
				requires: ['ui.skeleton' as const],
				provides: ['storage.object' as const],
				optional: [],
				optionalModules: []
			},
			p2: {
				template: 'base' as const,
				requires: ['storage.object' as const],
				provides: ['ui.skeleton' as const],
				optional: [],
				optionalModules: []
			}
		};
		// p1 needs ui.skeleton (provided by p2), p2 needs storage.object
		// (provided by p1) — with no template providing either, resolution
		// would loop forever. It must stop with a cycle error instead.
		const result = plan({ requested: ['p1'], contracts, template: undefined });
		expect(result.errors.map((e) => e.kind)).toContain('cycle');
	});
});

describe('module resolver — recommendations and determinism (#419)', () => {
	it('lists optional modules as recommendations only — never installs them', () => {
		const result = plan({ requested: ['chat'], template: 'dashboard' });
		expect(result.optionalUninstalled).toEqual(['notifications', 'realtime', 'uploads']);
		expect(result.order).toEqual(['chat']);
	});

	it('is deterministic across runs (stable order for equal inputs)', () => {
		const a = plan({ requested: ['chat', 'jobs'], template: 'dashboard' });
		const b = plan({ requested: ['chat', 'jobs'], template: 'dashboard' });
		expect(a.order).toEqual(b.order);
		expect(a.runtimeAttestations).toEqual(b.runtimeAttestations);
	});
});

describe('declared external capabilities in .svforge.json (#419)', () => {
	it('reads capabilities.provides and validates the tokens', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-declared-'));
		try {
			writeFileSync(
				join(dir, '.svforge.json'),
				JSON.stringify({ template: 'base', capabilities: { provides: ['auth.currentUser', 'NOT_A_CAPABILITY'] } })
			);
			const { provides, warnings } = readDeclaredProvides(dir);
			expect(provides).toEqual(['auth.currentUser']);
			expect(warnings.length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('returns nothing without a manifest', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-declared-'));
		try {
			const { provides, warnings } = readDeclaredProvides(dir);
			expect(provides).toEqual([]);
			expect(warnings).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('install gate integration (#419)', () => {
	it('an unsatisfiable capability points at the template that provides it', async () => {
		const { checkModuleCapabilities } = await import('../packages/addon-kit/src/capabilities');
		const dir = mkdtempSync(join(tmpdir(), 'sf-gate-'));
		try {
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
			const gate = checkModuleCapabilities(dir, 'blog');
			expect(gate.ok).toBe(false);
			const message = (gate as { message: string }).message;
			// ui.svforge is provided by both templates — the hint names them.
			expect(message).toMatch(/svforge=template:base/);
			expect(message).toMatch(/capabilities\.provides/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('the hint names the supporting modules when modules can provide the capability', async () => {
		const { formatResolverHint } = await import('../packages/addon-kit/src/resolve');
		const contracts = {
			bloglike: {
				template: 'base' as const,
				requires: ['storage.object' as const],
				provides: [],
				optional: [],
				optionalModules: []
			},
			store: {
				template: 'base' as const,
				requires: [],
				provides: ['storage.object' as const],
				optional: [],
				optionalModules: []
			}
		};
		const hint = formatResolverHint('bloglike', { contracts });
		expect(hint).toMatch(/svforge add bloglike/);
		expect(hint).toMatch(/store/);
	});

	it('a declared external provider silences the missing-capability failure', async () => {
		const { checkModuleCapabilities } = await import('../packages/addon-kit/src/capabilities');
		const dir = mkdtempSync(join(tmpdir(), 'sf-gate2-'));
		try {
			writeFileSync(
				join(dir, '.svforge.json'),
				JSON.stringify({ template: 'base', capabilities: { provides: ['ui.svforge'] } })
			);
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
			const gate = checkModuleCapabilities(dir, 'blog');
			// blog requires only ui.svforge — declared externally → gate passes.
			expect(gate.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
