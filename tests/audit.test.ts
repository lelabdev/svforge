import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
	AUDITED_LOCKFILES,
	collectPackages,
	formatFindings,
	isBaselined,
	loadBaseline,
	queryOsv,
	resolvedPackages,
	staleBaselineEntries,
	stripJsonc
} = await import('../scripts/audit.mjs');

const okFetch = (body: unknown) =>
	vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

const versionAtLeast = (version: string, floor: string) =>
	version.localeCompare(floor, 'en', { numeric: true }) >= 0;

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
		}`, 'bun.lock');

		expect(packages).toContainEqual({ name: '@types/ws', version: '8.18.1', paths: '@types/ws', lockfile: 'bun.lock' });
		expect(packages).toContainEqual({ name: 'ws', version: '8.21.3', paths: 'ws', lockfile: 'bun.lock' });
		expect(packages).toContainEqual({ name: 'postcss', version: '8.5.16', paths: 'vite/postcss', lockfile: 'bun.lock' });
		// Non-registry locators are excluded: OSV can only match published versions.
		expect(packages).toHaveLength(3);
	});

	it('audits every checked-in lockfile, including the Docker builder and consumer trees (#689)', () => {
		const packages = collectPackages();
		const byLockfile = new Map<string, number>();
		for (const pkg of packages) byLockfile.set(pkg.lockfile, (byLockfile.get(pkg.lockfile) ?? 0) + 1);

		expect([...byLockfile.keys()].sort()).toEqual([...AUDITED_LOCKFILES].sort());
		// The Docker lockfiles are the reason this coverage exists: they install
		// from their own resolved trees, not from the root workspace lockfile.
		expect(byLockfile.get('docker/builder.bun.lock')).toBeGreaterThan(0);
		expect(byLockfile.get('docker/examples/app/bun.lock')).toBeGreaterThan(0);
	});

	it('fails instead of silently shrinking coverage when an audited lockfile disappears', () => {
		const root = mkdtempSync(join(tmpdir(), 'audit-lockfiles-'));
		try {
			writeFileSync(join(root, 'bun.lock'), '{"packages":{"ws":["ws@8.21.3","",{},"digest"]}}');

			expect(() => collectPackages(['bun.lock', 'docker/builder.bun.lock'], root)).toThrow(
				/Audited lockfile is missing: docker\/builder\.bun\.lock/
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	/**
	 * Bun 1.3.x supports GLOBAL overrides only: nested (`parent>child`) and
	 * version-scoped (`pkg@range`) keys are rejected or silently ignored (#689),
	 * so a single version must satisfy every consumer. `@tailwindcss/typography`
	 * pins the vulnerable 6.0.10 exactly, while `svelte-eslint-parser` and
	 * `postcss-nested` require ^7 — therefore the patched v7 line is the only
	 * resolution that keeps every declared major satisfied and ships no
	 * vulnerable copy (#689, CVE-2026-104844).
	 */
	const PATCHED_SELECTOR_PARSER_FLOOR = '7.1.6';

	it('keeps every resolved selector parser copy on the patched 7.1.6+ line (#689)', () => {
		const copies = collectPackages().filter((pkg) => pkg.name === 'postcss-selector-parser');

		expect(copies.length).toBeGreaterThan(0);
		for (const pkg of copies) {
			// A 6.x copy (e.g. the legacy 6.1.5 backport) would force the major DOWN
			// on packages that declare ^7, which Bun cannot scope per consumer.
			expect(pkg.version.startsWith('7.'), `${pkg.lockfile}: forced ${pkg.name}@${pkg.version}`).toBe(true);
			expect(
				versionAtLeast(pkg.version, PATCHED_SELECTOR_PARSER_FLOOR),
				`${pkg.lockfile}: ${pkg.name}@${pkg.version}`
			).toBe(true);
		}
	});

	it('declares the selector parser override as a patched v7 pin wherever it is set (#689)', () => {
		// Regression guard: re-introducing a global v6 override would silently
		// downgrade every ^7 consumer again.
		const manifests = ['package.json', 'packages/svforge/templates/base/package.json', 'packages/svforge/templates/dashboard/package.json'];

		for (const manifest of manifests) {
			const pinned = JSON.parse(readFileSync(join(process.cwd(), manifest), 'utf8')).overrides?.['postcss-selector-parser'];
			if (pinned === undefined) continue;

			expect(pinned.startsWith('7.'), `${manifest}: ${pinned}`).toBe(true);
			expect(versionAtLeast(pinned.replace(/^[\^~]/, ''), PATCHED_SELECTOR_PARSER_FLOOR), `${manifest}: ${pinned}`).toBe(true);
		}
	});

	it('serves every dependent that declares postcss-selector-parser a patched copy (#689)', () => {
		// Structural check on the resolved trees rather than on our own test list:
		// every dependent that declares the package must receive a patched copy.
		// `@tailwindcss/typography`'s exact `6.0.10` pin is deliberately overridden
		// to the patched v7 line because a v6 copy cannot coexist with the ^7
		// consumers under Bun's global-only overrides (see the test above).
		const floor = PATCHED_SELECTOR_PARSER_FLOOR;

		for (const lockfile of AUDITED_LOCKFILES) {
			const lock = JSON.parse(stripJsonc(readFileSync(join(process.cwd(), lockfile), 'utf8')));
			for (const [key, entry] of Object.entries<unknown[]>(lock.packages ?? {})) {
				const declared = (entry[2] as { dependencies?: Record<string, string> } | undefined)?.dependencies?.['postcss-selector-parser'];
				if (!declared) continue;

				const nested = lock.packages?.[`${key}/postcss-selector-parser`];
				const hoisted = lock.packages?.['postcss-selector-parser'];
				const resolved = (nested ?? hoisted)?.[0]?.split('@').pop();
				expect(resolved, `${lockfile}: no copy for ${key}`).toBeTruthy();
				expect(
					versionAtLeast(resolved, floor),
					`${lockfile}: ${key} declares ${declared} but resolves ${resolved}`
				).toBe(true);
			}
		}
	});

	it('keeps the Docker consumer fixture above the patched zod floor of Dependabot #26', () => {
		const copies = collectPackages(['docker/examples/app/bun.lock']).filter((pkg) => pkg.name === 'zod');

		expect(copies).toHaveLength(1);
		expect(versionAtLeast(copies[0].version, '4.6.6')).toBe(true);
	});

	it('keeps every resolved devalue version on the patched 5.9.3+ line (#485)', () => {
		const packages = collectPackages(['bun.lock']).filter((pkg) => pkg.name === 'devalue');

		expect(packages.length).toBeGreaterThan(0);
		for (const pkg of packages) {
			expect(versionAtLeast(pkg.version, '5.9.3')).toBe(true);
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

	it('queries OSV in batches and keeps results aligned with the package order (#689)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: [{}, { vulns: [{ id: 'GHSA-a' }] }] }) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: [{ vulns: [{ id: 'GHSA-b' }] }] }) });
		const packages = [
			{ name: 'a', version: '1.0.0', paths: 'a', lockfile: 'bun.lock' },
			{ name: 'b', version: '1.0.0', paths: 'b', lockfile: 'bun.lock' },
			{ name: 'c', version: '1.0.0', paths: 'c', lockfile: 'docker/builder.bun.lock' }
		];

		const results = await queryOsv(packages, fetchImpl as unknown as typeof fetch, { batchSize: 2 });

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(formatFindings(packages, results).map((finding) => `${finding.name}:${finding.lockfile}`)).toEqual([
			'b:bun.lock',
			'c:docker/builder.bun.lock'
		]);
	});

	it('parses JSONC lockfiles with comments and trailing commas', () => {
		const lockfile = `// Bun lockfile\n// generated\n{\n\t// root workspace\n\t"packages": {\n\t\t"ws": ["ws@8.21.3", ""], // trailing\n\t\t"postcss": ["postcss@8.5.16", ""]\n\t}\n}`;
		const packages = resolvedPackages(lockfile, 'bun.lock');

		expect(packages).toContainEqual({ name: 'ws', version: '8.21.3', paths: 'ws', lockfile: 'bun.lock' });
		expect(packages).toContainEqual({ name: 'postcss', version: '8.5.16', paths: 'postcss', lockfile: 'bun.lock' });
	});

	it('does not treat comment markers inside string values as comments', () => {
		const lockfile = '{"packages":{"ws":["ws@8.21.3","https://example.test/a"]}}';

		expect(resolvedPackages(lockfile, 'bun.lock')).toEqual([{ name: 'ws', version: '8.21.3', paths: 'ws', lockfile: 'bun.lock' }]);
	});

	it('fails after retries on a persistently unreachable OSV API instead of passing silently', async () => {
		const transientFailure = Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } });
		const fetchImpl = vi.fn().mockRejectedValue(transientFailure);

		await expect(
			queryOsv([{ name: 'ws', version: '8.21.3' }], fetchImpl as unknown as typeof fetch, { retryDelayMs: 1 })
		).rejects.toThrow(/refusing to pass/);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('reports vulnerable packages with name, version, path, lockfile and advisory', () => {
		const packages = [{ name: 'nanoid', version: '3.3.15', paths: 'nanoid', lockfile: 'docker/examples/app/bun.lock' }];
		const results = {
			results: [{ vulns: [{ id: 'GHSA-xxxx', aliases: ['CVE-2026-0000'], summary: '  insecure generation  ' }] }]
		};

		expect(formatFindings(packages, results)).toEqual([
			{
				name: 'nanoid',
				version: '3.3.15',
				path: 'nanoid',
				lockfile: 'docker/examples/app/bun.lock',
				package: 'nanoid@3.3.15',
				advisory: 'GHSA-xxxx, CVE-2026-0000',
				ids: ['GHSA-xxxx', 'CVE-2026-0000'],
				summary: 'insecure generation'
			}
		]);
	});

	it('scopes baseline matching to lockfile + package + version + path + advisory (#359, #689)', () => {
		const finding = {
			name: 'nanoid',
			version: '3.3.15',
			path: 'nanoid',
			lockfile: 'bun.lock',
			package: 'nanoid@3.3.15',
			advisory: 'GHSA-xxxx',
			ids: ['GHSA-xxxx', 'CVE-2026-0000'],
			summary: 'x'
		};
		const baseline = [
			{
				lockfile: 'bun.lock',
				package: 'nanoid',
				version: '3.3.15',
				path: 'nanoid',
				advisory: 'GHSA-xxxx',
				reason: '2026-10-30: dev-only transitive'
			}
		];

		expect(isBaselined(finding, baseline)).toBe(true);
		// Same advisory, different version: NOT covered.
		expect(isBaselined({ ...finding, version: '3.3.16' }, baseline)).toBe(false);
		// Same package/version, introduced through another dependency path: NOT covered.
		expect(isBaselined({ ...finding, path: 'vite/nanoid' }, baseline)).toBe(false);
		// Same package/version/path in another lockfile: NOT covered.
		expect(isBaselined({ ...finding, lockfile: 'docker/builder.bun.lock' }, baseline)).toBe(false);
		// Same package, different advisory: NOT covered.
		expect(isBaselined({ ...finding, ids: ['GHSA-yyyy'], advisory: 'GHSA-yyyy' }, baseline)).toBe(false);
	});

	it('flags baseline entries that no longer match a resolved package', () => {
		const packages = [{ name: 'nanoid', version: '3.3.15', paths: 'nanoid', lockfile: 'bun.lock' }];
		const baseline = [
			{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: why' },
			{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.14', path: 'nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: why' },
			{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.15', path: 'vite/nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: why' },
			{ lockfile: 'docker/builder.bun.lock', package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: why' }
		];

		expect(staleBaselineEntries(baseline, packages)).toEqual([baseline[1], baseline[2], baseline[3]]);
	});

	it('rejects baseline entries without a full scope, review date and justification', () => {
		const root = mkdtempSync(join(tmpdir(), 'audit-baseline-'));
		try {
			const missing = join(root, 'absent.json');
			expect(loadBaseline(missing)).toEqual([]);

			const invalidPath = join(root, 'invalid.json');
			writeFileSync(invalidPath, JSON.stringify([{ lockfile: 'bun.lock', package: 'nanoid', advisory: 'GHSA-xxxx' }]));
			expect(() => loadBaseline(invalidPath)).toThrow(/needs a non-empty string version/);

			const noLockfile = join(root, 'no-lockfile.json');
			writeFileSync(noLockfile, JSON.stringify([{ package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: why' }]));
			expect(() => loadBaseline(noLockfile)).toThrow(/needs a non-empty string lockfile/);

			const undated = join(root, 'undated.json');
			writeFileSync(undated, JSON.stringify([{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: 'dev-only transitive' }]));
			expect(() => loadBaseline(undated)).toThrow(/must start with its review date/);

			const todoPath = join(root, 'todo.json');
			writeFileSync(todoPath, JSON.stringify([
				{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: 'TODO: justify this exception before the next release.' }
			]));
			expect(() => loadBaseline(todoPath)).toThrow(/unjustified baseline entry/);

			const validPath = join(root, 'valid.json');
			writeFileSync(validPath, JSON.stringify([
				{ lockfile: 'bun.lock', package: 'nanoid', version: '3.3.15', path: 'nanoid', advisory: 'GHSA-xxxx', reason: '2026-10-30: dev-only transitive via postcss' }
			]));
			expect(loadBaseline(validPath)).toHaveLength(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('accepts the checked-in baseline for the checked-in lockfiles', () => {
		const baseline = loadBaseline();
		const packages = collectPackages();

		// Any entry that no longer matches a resolved package is an obsolete
		// exception and must be removed, not silently carried forward (#689).
		expect(staleBaselineEntries(baseline, packages)).toEqual([]);
	});

	it('reports no findings on a clean OSV response for the real lockfiles', async () => {
		const fetchImpl = okFetch({ results: [] });
		const packages = collectPackages();
		const results = await queryOsv(packages, fetchImpl as unknown as typeof fetch);

		expect(packages.length).toBeGreaterThan(0);
		expect(formatFindings(packages, results)).toEqual([]);
	});
});
