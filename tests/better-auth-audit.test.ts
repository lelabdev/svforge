import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { auditBetterAuth, betterAuthClosurePaths, severityOf, SEVERITY_RANK, isBetterAuthScope }
	= await import('../scripts/better-auth-audit.mjs');

const okFetch = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

afterEach(() => vi.restoreAllMocks());

const LOCKFILE = `{
	"packages": {
		"better-auth": ["better-auth@1.7.3", "", {}, "digest"],
		"better-auth/@better-auth/core": ["@better-auth/core@1.7.3", "", {}, "digest"],
		"better-auth/jose": ["jose@6.2.3", "", {}, "digest"],
		"unrelated": ["left-pad@1.3.0", "", {}, "digest"]
	}
}`;

describe('better-auth runtime vulnerability audit (#319)', () => {
	describe('severityOf', () => {
		it('prefers the GHSA database_specific severity', () => {
			expect(severityOf({ database_specific: { severity: 'HIGH' } })).toBe('HIGH');
			expect(severityOf({ database_specific: { severity: 'MODERATE' }, severity: [{ type: 'CVSS_V3', score: '9.8' }] })).toBe('MODERATE');
		});

		it('fails closed on unknown severity — treated as HIGH', () => {
			expect(severityOf({})).toBe('HIGH');
			expect(severityOf({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N' }] })).toBe('HIGH');
		});
	});

	describe('SEVERITY_RANK', () => {
		it('blocks critical and high only', () => {
			expect(SEVERITY_RANK.CRITICAL).toBeGreaterThanOrEqual(3);
			expect(SEVERITY_RANK.HIGH).toBeGreaterThanOrEqual(3);
			expect(SEVERITY_RANK.MODERATE).toBeLessThan(3);
			expect(SEVERITY_RANK.LOW).toBeLessThan(3);
		});
	});

	describe('isBetterAuthScope', () => {
		it('scopes the audit to better-auth and @better-auth/* only', () => {
			expect(isBetterAuthScope({ name: 'better-auth', version: '1', paths: 'better-auth' })).toBe(true);
			expect(isBetterAuthScope({ name: '@better-auth/cli', version: '1', paths: '@better-auth/cli' })).toBe(true);
			expect(isBetterAuthScope({ name: 'jose', version: '1', paths: 'better-auth/jose' })).toBe(true);
			expect(isBetterAuthScope({ name: 'left-pad', version: '1', paths: 'unrelated' })).toBe(false);
		});
	});

	// Real-world shape (verified against a scratch `bun add better-auth@1.7.3`
	// lockfile): transitive deps are HOISTED to root keys — "jose" sits at the
	// root, so a path-only scope filter silently drops it (#319 review). The
	// closure walk must start from better-auth/@better-auth/* entries and
	// follow dependencies, optionalDependencies and REQUIRED peer dependencies
	// (optionalPeers excluded), resolving each dep to its shallowest entry.
	const HOISTED_LOCKFILE = `{
	"packages": {
		"better-auth": ["better-auth@1.7.3", "", { "dependencies": { "@better-auth/core": "1.7.3", "jose": "^6.2.3", "zod": "^4.5.4" }, "peerDependencies": { "svelte": "^4.0.0 || ^5.0.0", "pg": "^8.0.0" }, "optionalPeers": ["svelte", "pg"] }, "sha"],
		"@better-auth/core": ["@better-auth/core@1.7.3", "", { "peerDependencies": { "jose": "^6.1.0" } }, "sha"],
		"jose": ["jose@6.2.12", "", {}, "sha"],
		"zod": ["zod@4.5.4", "", {}, "sha"],
		"svelte": ["svelte@5.57.0", "", {}, "sha"],
		"left-pad": ["left-pad@1.3.0", "", {}, "sha"]
	}
}`;

	describe('betterAuthClosurePaths (#319 review: hoisted transitive closure)', () => {
		it('walks the full dependency closure from the better-auth entries', () => {
			const closure = betterAuthClosurePaths(HOISTED_LOCKFILE);
			expect([...closure].sort()).toEqual(['@better-auth/core', 'better-auth', 'jose', 'zod']);
		});

		it('includes the hoisted transitive dependency (jose at a root key)', () => {
			// Regression for the #319 review finding: path-based scoping missed it.
			const closure = betterAuthClosurePaths(HOISTED_LOCKFILE);
			expect(closure.has('jose')).toBe(true);
		});

		it('includes REQUIRED peer dependencies but excludes optionalPeers', () => {
			const closure = betterAuthClosurePaths(HOISTED_LOCKFILE);
			// jose is a required peer of @better-auth/core → in the closure.
			expect(closure.has('jose')).toBe(true);
			// svelte is only an optional peer of better-auth (installed or not) → out.
			expect(closure.has('svelte')).toBe(false);
			// pg is an uninstalled optional peer → out.
			expect(closure.has('pg')).toBe(false);
		});

		it('resolves nested duplicates to the shallowest (hoisted) entry', () => {
			const nested = `{
				"packages": {
					"better-auth": ["better-auth@1.7.3", "", { "dependencies": { "jose": "^6.2.3" } }, "sha"],
					"jose": ["jose@6.2.12", "", {}, "sha"],
					"better-auth/jose": ["jose@5.9.6", "", {}, "sha"]
				}
			}`;
			const closure = betterAuthClosurePaths(nested);
			expect(closure.has('jose')).toBe(true);
			expect(closure.has('better-auth/jose')).toBe(false);
		});

		it('is robust to cyclic dependency metadata', () => {
			const cyclic = `{
				"packages": {
					"better-auth": ["better-auth@1.7.3", "", { "dependencies": { "jose": "^6.2.3" } }, "sha"],
					"jose": ["jose@6.2.12", "", { "dependencies": { "better-auth": "1.7.3" } }, "sha"]
				}
			}`;
			expect(() => betterAuthClosurePaths(cyclic)).not.toThrow();
			expect([...betterAuthClosurePaths(cyclic)].sort()).toEqual(['better-auth', 'jose']);
		});
	});

	describe('auditBetterAuth', () => {
		it('detects critical advisories on HOISTED transitive packages of the closure (#319 review)', async () => {
			// Old behavior failed this: jose@6.2.12 sits at the root lockfile key,
			// so the path filter never queried it — the vuln passed silently.
			const fetchImpl = okFetch({
				results: [
					{ vulns: [] },
					{ vulns: [] },
					{ vulns: [{ id: 'GHSA-jose-hoisted', database_specific: { severity: 'CRITICAL' }, summary: 'jose request smuggling' }] },
					{ vulns: [] }
				]
			});
			const { blocking, findings } = await auditBetterAuth({ lockfile: HOISTED_LOCKFILE, baseline: [], fetchImpl });
			expect(findings.map((f: unknown) => (f as { name: string }).name)).toContain('jose');
			expect(blocking).toHaveLength(1);
			expect(blocking[0]).toMatchObject({ name: 'jose', version: '6.2.12', path: 'jose' });
		});

		it('reports critical/high advisories on the better-auth stack as blocking', async () => {
			const fetchImpl = okFetch({
				results: [
					{ vulns: [{ id: 'GHSA-g38m-r43w-p2q7', aliases: ['CVE-XXXX'], database_specific: { severity: 'CRITICAL' }, summary: 'OAuth auto-link takeover' }] },
					{ vulns: [] },
					{ vulns: [] }
				]
			});
			const { blocking, findings } = await auditBetterAuth({ lockfile: LOCKFILE, baseline: [], fetchImpl });

			expect(findings).toHaveLength(1);
			expect(blocking).toHaveLength(1);
			expect(blocking[0]).toMatchObject({ name: 'better-auth', advisory: expect.stringContaining('GHSA-g38m-r43w-p2q7') });
		});

		it('reports moderate/low advisories without blocking', async () => {
			const fetchImpl = okFetch({
				results: [
					{ vulns: [{ id: 'GHSA-low', database_specific: { severity: 'LOW' }, summary: 'minor' }] },
					{ vulns: [] },
					{ vulns: [] }
				]
			});
			const { blocking } = await auditBetterAuth({ lockfile: LOCKFILE, baseline: [], fetchImpl });
			expect(blocking).toHaveLength(0);
		});

		it('honors documented reachability exceptions from the audit baseline (#351 mechanism)', async () => {
			const fetchImpl = okFetch({
				results: [
					{ vulns: [{ id: 'GHSA-g38m-r43w-p2q7', database_specific: { severity: 'HIGH' }, summary: 'x' }] },
					{ vulns: [] },
					{ vulns: [] }
				]
			});
			const baselinePath = join(mkdtempSync(join(tmpdir(), 'sf-ba-baseline-')), 'baseline.json');
			writeFileSync(
				baselinePath,
				JSON.stringify([
					{
						lockfile: 'better-auth-stack',
						package: 'better-auth',
						version: '1.7.3',
						advisory: 'GHSA-g38m-r43w-p2q7',
						path: 'better-auth',
						reason: '2026-10-30: not reachable, oauth auto-link disabled in the dashboard config'
					}
				])
			);
			try {
				const { blocking, baselined } = await auditBetterAuth({
					lockfile: LOCKFILE,
					baselinePath,
					fetchImpl
				});
				expect(blocking).toHaveLength(0);
				expect(baselined).toHaveLength(1);
			} finally {
				rmSync(join(baselinePath, '..'), { recursive: true, force: true });
			}
		});

		it('ignores advisories on packages outside the better-auth stack', async () => {
			// The scope filter removes left-pad BEFORE querying OSV: only three
			// packages are queried, so the stub returns three result entries.
			const fetchImpl = okFetch({
				results: [
					{ vulns: [] },
					{ vulns: [] },
					{ vulns: [{ id: 'GHSA-jose', database_specific: { severity: 'CRITICAL' } }] }
				]
			});
			const { blocking } = await auditBetterAuth({ lockfile: LOCKFILE, baseline: [], fetchImpl });
			// jose IS a better-auth dependency (scope by path).
			expect(blocking.map((f: unknown) => (f as { advisory: string }).advisory)).toEqual(['GHSA-jose']);
		});
	});
});
