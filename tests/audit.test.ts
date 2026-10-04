import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { formatFindings, isBaselined, loadBaseline, queryOsv, resolvedPackages } = await import('../scripts/audit.mjs');

const okFetch = (body: unknown) =>
	vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

describe('dependency audit (#351)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('extracts resolved name@version pairs from bun.lock, including scoped packages', () => {
		const packages = resolvedPackages(`{
			"packages": {
				"@types/ws": ["@types/ws@8.18.1", "", {}, "digest"],
				"ws": ["ws@8.21.3", "", {}, "digest"],
				"vite/postcss": ["postcss@8.5.16", "", {}, "digest"],
				"svforge": ["svforge@workspace:packages/svforge"],
				"pinned": ["pinned@https://example.test/pinned.tgz"]
			}
		}`);

		expect(packages).toContainEqual({ name: '@types/ws', version: '8.18.1', paths: '@types/ws' });
		expect(packages).toContainEqual({ name: 'ws', version: '8.21.3', paths: 'ws' });
		expect(packages).toContainEqual({ name: 'postcss', version: '8.5.16', paths: 'vite/postcss' });
		// Non-registry locators are excluded: OSV can only match published versions.
		expect(packages).toHaveLength(3);
	});

	it('keeps every resolved devalue version on the patched 5.9.3+ line (#485)', () => {
		const packages = resolvedPackages().filter((pkg) => pkg.name === 'devalue');

		expect(packages.length).toBeGreaterThan(0);
		for (const pkg of packages) {
			expect(pkg.version.localeCompare('5.9.3', 'en', { numeric: true })).toBeGreaterThanOrEqual(0);
		}
	});

	it('sends version beside package, per the official querybatch schema (#359)', async () => {
		const fetchImpl = okFetch({ results: [] });

		await queryOsv(
			[
				{ name: '@types/ws', version: '8.18.1' },
				{ name: 'ws', version: '8.21.3' }
			],
			fetchImpl as unknown as typeof fetch
		);

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://api.osv.dev/v1/querybatch',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					queries: [
						{ package: { name: '@types/ws', ecosystem: 'npm' }, version: '8.18.1' },
						{ package: { name: 'ws', ecosystem: 'npm' }, version: '8.21.3' }
					]
				})
			})
		);
	});

	it('parses JSONC lockfiles with comments and trailing commas', () => {
		const lockfile = `// Bun lockfile\n// generated\n{\n\t// root workspace\n\t"packages": {\n\t\t"ws": ["ws@8.21.3", ""], // trailing\n\t\t"postcss": ["postcss@8.5.16", ""]\n\t}\n}`;
		const packages = resolvedPackages(lockfile);

		expect(packages).toContainEqual({ name: 'ws', version: '8.21.3', paths: 'ws' });
		expect(packages).toContainEqual({ name: 'postcss', version: '8.5.16', paths: 'postcss' });
	});

	it('does not treat comment markers inside string values as comments', () => {
		const lockfile = '{"packages":{"ws":["ws@8.21.3","https://example.test/a"]}}';

		expect(resolvedPackages(lockfile)).toEqual([{ name: 'ws', version: '8.21.3', paths: 'ws' }]);
	});

	it('fails after retries on a persistently unreachable OSV API instead of passing silently', async () => {
		const transientFailure = Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } });
		const fetchImpl = vi.fn().mockRejectedValue(transientFailure);

		await expect(
			queryOsv([{ name: 'ws', version: '8.21.3' }], fetchImpl as unknown as typeof fetch, { retryDelayMs: 1 })
		).rejects.toThrow(/refusing to pass/);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('reports vulnerable packages with name, version, path, and advisory', () => {
		const packages = [{ name: 'nanoid', version: '3.3.15', paths: 'nanoid' }];
		const results = {
			results: [{ vulns: [{ id: 'GHSA-xxxx', aliases: ['CVE-2026-0000'], summary: '  insecure generation  ' }] }]
		};

		expect(formatFindings(packages, results)).toEqual([
			{
				name: 'nanoid',
				version: '3.3.15',
				path: 'nanoid',
				package: 'nanoid@3.3.15',
				advisory: 'GHSA-xxxx, CVE-2026-0000',
				ids: ['GHSA-xxxx', 'CVE-2026-0000'],
				summary: 'insecure generation'
			}
		]);
	});

	it('scopes baseline matching to package + version + path + advisory (#359)', () => {
		const finding = {
			name: 'nanoid',
			version: '3.3.15',
			path: 'nanoid',
			package: 'nanoid@3.3.15',
			advisory: 'GHSA-xxxx',
			ids: ['GHSA-xxxx', 'CVE-2026-0000'],
			summary: 'x'
		};
		const baseline = [{ package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: 'dev-only transitive' }];

		expect(isBaselined(finding, baseline)).toBe(true);
		// Same advisory, different version: NOT covered.
		expect(isBaselined({ ...finding, version: '3.3.16' }, baseline)).toBe(false);
		// Same package/version, introduced through another dependency path: NOT covered.
		expect(isBaselined({ ...finding, path: 'vite/nanoid' }, baseline)).toBe(false);
		// Same package, different advisory: NOT covered.
		expect(isBaselined({ ...finding, ids: ['GHSA-yyyy'], advisory: 'GHSA-yyyy' }, baseline)).toBe(false);
	});

	it('rejects baseline entries without a full scope and justification', () => {
		const root = mkdtempSync(join(tmpdir(), 'audit-baseline-'));
		try {
			const missing = join(root, 'absent.json');
			expect(loadBaseline(missing)).toEqual([]);

			const invalidPath = join(root, 'invalid.json');
			writeFileSync(invalidPath, JSON.stringify([{ package: 'nanoid', advisory: 'GHSA-xxxx' }]));
			expect(() => loadBaseline(invalidPath)).toThrow(/needs a non-empty string version/);

			const todoPath = join(root, 'todo.json');
			writeFileSync(todoPath, JSON.stringify([
				{ package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: 'TODO: justify this exception before the next release.' }
			]));
			expect(() => loadBaseline(todoPath)).toThrow(/unjustified baseline entry/);

			const validPath = join(root, 'valid.json');
			writeFileSync(validPath, JSON.stringify([
				{ package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: 'dev-only transitive via postcss' }
			]));
			expect(loadBaseline(validPath)).toHaveLength(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('reports no findings on a clean OSV response for the real bun.lock', async () => {
		const fetchImpl = okFetch({ results: [] });
		const packages = resolvedPackages();
		const results = await queryOsv(packages, fetchImpl as unknown as typeof fetch);

		expect(packages.length).toBeGreaterThan(0);
		expect(formatFindings(packages, results)).toEqual([]);
	});
});
