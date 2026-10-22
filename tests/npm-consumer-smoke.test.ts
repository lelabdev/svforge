import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { consumerInstallSpecs, consumerSource, consumerTsConfig, packageTypePath, validateInstalledTypes, waitForRegistryAvailability, registryVersionVisible, tarballAvailable, registryReleaseConsumable } = await import('../scripts/npm-consumer-smoke.mjs');

describe('npm consumer smoke test (#330)', () => {
	it('resolves the declared type entry for every exact package', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-consumer-fixture-'));
		try {
			const plan = {
				packages: [
					{ name: '@svforge/audit', version: '0.0.1' },
					{ name: 'svforge', version: '1.2.0' }
				]
			};
			for (const pkg of plan.packages) {
				const packageRoot = join(root, 'node_modules', ...pkg.name.split('/'));
				mkdirSync(join(packageRoot, 'dist'), { recursive: true });
				writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
					name: pkg.name,
					types: './dist/index.d.ts',
					exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }
				}));
				writeFileSync(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
			}

			expect(packageTypePath({ types: './dist/index.d.ts' })).toBe('./dist/index.d.ts');
			expect(validateInstalledTypes(plan, root)).toEqual([]);
			expect(consumerSource(plan)).toContain("import * as package0 from \"@svforge/audit\";");
			expect(consumerSource(plan)).toContain("import * as package1 from \"svforge\";");
			expect(consumerTsConfig().compilerOptions.moduleResolution).toBe('NodeNext');
			expect(consumerTsConfig().compilerOptions.noEmit).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('installs snapshot tarballs locally while pinning unchanged packages to exact stable versions', () => {
		const plan = {
			packages: [
				{ name: '@svforge/changed', version: '0.0.0-canary-sha-1', snapshot: true, tarball: '/tmp/changed.tgz' },
				{ name: '@svforge/unchanged', version: '2.4.0', snapshot: false }
			]
		};
		expect(consumerInstallSpecs(plan)).toEqual(['/tmp/changed.tgz', '@svforge/unchanged@2.4.0']);
		expect(consumerInstallSpecs(plan, { registryOnly: true })).toEqual([
			'@svforge/changed@0.0.0-canary-sha-1', '@svforge/unchanged@2.4.0'
		]);
	});

	it('reports a package with a missing declaration entry', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-consumer-missing-'));
		try {
			const packageRoot = join(root, 'node_modules', '@svforge', 'audit');
			mkdirSync(packageRoot, { recursive: true });
			writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
				name: '@svforge/audit',
				types: './dist/index.d.ts'
			}));
			expect(validateInstalledTypes({ packages: [{ name: '@svforge/audit', version: '0.0.1' }] }, root)).toEqual([
				'@svforge/audit: declared TypeScript entry point is missing'
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('retries only versions not yet visible, without confusing propagation with a broken tarball', async () => {
		const seen: string[] = [];
		let auditChecks = 0;
		let waits = 0;
		const plan = { packages: [
			{ name: '@svforge/audit', version: '2.2.0' },
			{ name: '@svforge/blog', version: '2.2.0' }
		] };
		await waitForRegistryAvailability(plan, {
			maxAttempts: 3,
			intervalMs: 1,
			probe: (spec: string) => {
				seen.push(spec);
				if (spec.startsWith('@svforge/audit@')) return ++auditChecks > 1;
				return true;
			},
			pause: async () => { waits++; }
		});
		expect(seen).toEqual([
			'@svforge/audit@2.2.0',
			'@svforge/blog@2.2.0',
			'@svforge/audit@2.2.0'
		]);
		expect(waits).toBe(1);
	});

	it('fails with the exact unavailable version after bounded registry checks', async () => {
		let waits = 0;
		await expect(waitForRegistryAvailability({
			packages: [{ name: '@svforge/audit', version: '2.2.0' }]
		}, {
			maxAttempts: 3,
			intervalMs: 1,
			probe: () => false,
			pause: async () => { waits++; }
		})).rejects.toThrow('npm registry propagation timed out after 3 checks: @svforge/audit@2.2.0');
		expect(waits).toBe(2);
	});

	it('never retries an unexpected authentication or registry failure', async () => {
		let attempts = 0;
		await expect(waitForRegistryAvailability({
			packages: [{ name: '@svforge/audit', version: '2.2.0' }]
		}, {
			maxAttempts: 8,
			probe: () => { attempts++; throw new Error('E401 authentication rejected'); },
			pause: async () => { throw new Error('unexpected wait'); }
		})).rejects.toThrow('E401');
		expect(attempts).toBe(1);
	});

	it('checks stable dependencies but not unpublished local snapshots until the post-publish phase', async () => {
		const plan = { packages: [
			{ name: '@svforge/changed', version: '0.0.0-canary.1', tarball: '/tmp/changed.tgz' },
			{ name: '@svforge/unchanged', version: '2.2.0' }
		] };
		const pre: string[] = [];
		await waitForRegistryAvailability(plan, { probe: (spec: string) => { pre.push(spec); return true; } });
		expect(pre).toEqual(['@svforge/unchanged@2.2.0']);
		const post: string[] = [];
		await waitForRegistryAvailability(plan, { registryOnly: true, probe: (spec: string) => { post.push(spec); return true; } });
		expect(post).toEqual(['@svforge/changed@0.0.0-canary.1', '@svforge/unchanged@2.2.0']);
	});

	it('uses a fresh temporary npm cache for each registry visibility probe', () => {
		const dirs: string[] = [];
		const fake = ((_npm: string, args: string[]) => {
			const idx = args.indexOf('--cache');
			expect(idx).toBeGreaterThan(0);
			const cache = args[idx + 1];
			dirs.push(cache);
			expect(existsSync(cache)).toBe(true);
			expect(args).toContain('--prefer-online');
			return '"2.2.1"';
		}) as unknown as Parameters<typeof registryVersionVisible>[2];
		expect(registryVersionVisible('svforge@2.2.1', 'npm', fake)).toBe(true);
		expect(registryVersionVisible('svforge@2.2.1', 'npm', fake)).toBe(true);
		expect(new Set(dirs).size).toBe(2);
		for (const dir of dirs) expect(existsSync(dir)).toBe(false);
	});

	it('logs unexpected npm version responses instead of silently retrying forever', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const fake = (() => '"2.2.0"') as unknown as Parameters<typeof registryVersionVisible>[2];
			expect(registryVersionVisible('svforge@2.2.1', 'npm', fake)).toBe(false);
			expect(log).toHaveBeenCalledWith(expect.stringContaining('npm view returned "2.2.0"'));
		} finally {
			log.mockRestore();
		}
	});

	it('cleans up the temporary cache even when npm fails unexpectedly', () => {
		let cache = '';
		const fake = ((_npm: string, args: string[]) => {
			cache = args[args.indexOf('--cache') + 1];
			throw Object.assign(new Error('access denied'), { stderr: 'npm error code E401' });
		}) as unknown as Parameters<typeof registryVersionVisible>[2];
		expect(() => registryVersionVisible('svforge@2.2.1', 'npm', fake)).toThrow(/Registry lookup failed/);
		expect(cache).not.toBe('');
		expect(existsSync(cache)).toBe(false);
	});

	it('distinguishes a missing npm version from credentials and server failures', () => {
		const fake = (output: string | Error) => (
			(() => { if (output instanceof Error) throw output; return output; }) as unknown as Parameters<typeof registryVersionVisible>[2]
		);
		expect(registryVersionVisible('@svforge/audit@2.2.0', 'npm', fake('"2.2.0"'))).toBe(true);
		expect(registryVersionVisible('@svforge/audit@2.2.0', 'npm', fake('"2.1.0"'))).toBe(false);
		expect(registryVersionVisible('@svforge/audit@2.2.0', 'npm',
			fake(Object.assign(new Error('not found'), { stderr: 'npm error code ETARGET' })))).toBe(false);
		expect(() => registryVersionVisible('@svforge/audit@2.2.0', 'npm',
			fake(Object.assign(new Error('access denied'), { stderr: 'npm error code E401' })))).toThrow(/Registry lookup failed/);
	});

	describe('exact tarball availability (#628)', () => {
		const gzipBody = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const integrityOf = (body: Buffer) => `sha512-${createHash('sha512').update(body).digest('base64')}`;
		const tarballUrl = 'https://registry.npmjs.org/svforge/-/svforge-2.5.0.tgz';
		const metadata = (url = tarballUrl, integrity = integrityOf(gzipBody)) =>
			JSON.stringify({ 'dist.tarball': url, 'dist.integrity': integrity });
		const npmReturning = (payload: string) => (() => payload) as unknown as NonNullable<Parameters<typeof tarballAvailable>[2]>['run'];
		const fetchReturning = (status: number, body: Buffer = gzipBody) =>
			(async () => new Response(status === 200 ? new Uint8Array(body) : 'missing', { status })) as unknown as typeof fetch;

		it('accepts the exact tarball when the registry metadata and bytes agree', async () => {
			expect(
				await tarballAvailable('svforge@2.5.0', 'npm', {
					run: npmReturning(metadata()),
					fetchImpl: fetchReturning(200)
				})
			).toBe(true);
		});

		it('retries only a verified 404 of the expected tarball', async () => {
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			try {
				expect(
					await tarballAvailable('svforge@2.5.0', 'npm', {
						run: npmReturning(metadata()),
						fetchImpl: fetchReturning(404)
					})
				).toBe(false);
				expect(log).toHaveBeenCalledWith(expect.stringContaining(`tarball ${tarballUrl} returned HTTP 404`));
			} finally {
				log.mockRestore();
			}
		});

		it('treats a missing version (E404/ETARGET) as not-ready but never retries other npm failures', async () => {
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			try {
				const notFound = (() => {
					throw Object.assign(new Error('missing'), { stderr: 'npm error code E404' });
				}) as unknown as NonNullable<Parameters<typeof tarballAvailable>[2]>['run'];
				expect(await tarballAvailable('svforge@2.5.0', 'npm', { run: notFound, fetchImpl: fetchReturning(200) })).toBe(false);

				const denied = (() => {
					throw Object.assign(new Error('denied'), { stderr: 'npm error code E401' });
				}) as unknown as NonNullable<Parameters<typeof tarballAvailable>[2]>['run'];
				await expect(
					tarballAvailable('svforge@2.5.0', 'npm', { run: denied, fetchImpl: fetchReturning(200) })
				).rejects.toThrow(/Registry lookup failed/);
			} finally {
				log.mockRestore();
			}
		});

		it('fails hard on a checksum mismatch instead of retrying a broken artifact', async () => {
			await expect(
				tarballAvailable('svforge@2.5.0', 'npm', {
					run: npmReturning(metadata(tarballUrl, integrityOf(Buffer.from('other')))),
					fetchImpl: fetchReturning(200)
				})
			).rejects.toThrow(/integrity mismatch/);
		});

		it('fails hard on unexpected HTTP statuses, network errors and non-gzip bodies', async () => {
			await expect(
				tarballAvailable('svforge@2.5.0', 'npm', { run: npmReturning(metadata()), fetchImpl: fetchReturning(503) })
			).rejects.toThrow(/HTTP 503/);

			const networkError = (async () => {
				throw new Error('ECONNRESET');
			}) as unknown as typeof fetch;
			await expect(
				tarballAvailable('svforge@2.5.0', 'npm', { run: npmReturning(metadata()), fetchImpl: networkError })
			).rejects.toThrow(/Tarball fetch failed .*ECONNRESET/);

			await expect(
				tarballAvailable('svforge@2.5.0', 'npm', {
					run: npmReturning(metadata()),
					fetchImpl: fetchReturning(200, Buffer.from('<!doctype html>'))
				})
			).rejects.toThrow(/not a gzip artifact/);
		});

		it('refuses to guess a tarball URL from incomplete metadata', async () => {
			await expect(
				tarballAvailable('svforge@2.5.0', 'npm', { run: npmReturning('{}'), fetchImpl: fetchReturning(200) })
			).rejects.toThrow(/no dist\.tarball/);
		});

		it('waits for a tarball 404 to clear and then installs', async () => {
			let probes = 0;
			let waits = 0;
			await waitForRegistryAvailability({ packages: [{ name: 'svforge', version: '2.5.0' }] }, {
				maxAttempts: 4,
				intervalMs: 1,
				probe: async () => ++probes > 2,
				pause: async () => {
					waits++;
				}
			});
			expect(probes).toBe(3);
			expect(waits).toBe(2);
		});

		it('verifies metadata and bytes through the composed consumability probe', async () => {
			const fields: string[] = [];
			const run = ((_npm: string, args: string[]) => {
				fields.push(args[2]);
				return args[2] === 'version' ? '"2.5.0"' : '{"dist.tarball":"u","dist.integrity":"x"}';
			}) as unknown as NonNullable<Parameters<typeof registryReleaseConsumable>[2]>['run'];
			const fetchImpl = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch;

			expect(await registryReleaseConsumable('svforge@2.5.0', 'npm', { run, fetchImpl })).toBe(false);
			expect(fields).toEqual(['version', 'dist.tarball']);
		});
	});
});
