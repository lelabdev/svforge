import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_RELEASE_DOC_AGE_DAYS, SOURCES, verifyReleaseDocs, verifySnapshot } from '../scripts/check-release-docs.mjs';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const now = Date.parse('2026-10-22T12:00:00Z');
const spec = SOURCES[0];
const example = (date = '2026-10-01') => '---\nsource: https://skeleton.dev/llms-full.txt\nfetched: ' +
	date + '\n---\n\n' + 'preset-tonal --typo-base--font-family '.repeat(400);
const lock = (content: string) => ({
	file: spec.file,
	url: spec.url,
	dependency: spec.dependency,
	versionRange: '^5.0.1',
	major: 5,
	sha256: createHash('sha256').update(content).digest('hex')
});
const check = (content = example(), metadata = lock(content)) =>
	verifySnapshot({ content, metadata, spec, dependencyVersion: '^5.0.1', now });

describe('reviewed documentation release gate (#634)', () => {
	it('validates the current pinned, audited two-source snapshot set', () => {
		const checked = verifyReleaseDocs({ root, now });
		expect(checked).toHaveLength(2);
		expect(checked.map((s: { spec: { file: string } }) => s.spec.file)).toEqual(SOURCES.map((s: { file: string }) => s.file));
	});

	it('accepts a recent, correctly pinned supported-major snapshot', () => {
		expect(check().ageDays).toBeGreaterThanOrEqual(0);
	});

	it('rejects stale and future-dated documentation', () => {
		const outdated = example('2026-07-01');
		expect(() => check(outdated, lock(outdated))).toThrow(/outside the 90-day release window/);
		const future = example('2026-11-20');
		expect(() => check(future, lock(future))).toThrow(/outside the 90-day release window/);
		expect(MAX_RELEASE_DOC_AGE_DAYS).toBe(90);
	});

	it('rejects stale hashes or mismatched Svelte/Skeleton version pins', () => {
		expect(() => check(example(), lock(example('2026-09-01')))).toThrow(/contents changed/);
		expect(() => check(example(), { ...lock(example()), versionRange: '^6.0.0' })).toThrow(/dependency version changed/);
		expect(() => check(example(), { ...lock(example()), major: 4 })).toThrow(/documented major/);
	});

	it('rejects wrong sources and incomplete documentation', () => {
		const unknown = example().replace('https://skeleton.dev/llms-full.txt', 'https://unknown.invalid/full.txt');
		expect(() => check(unknown, lock(unknown))).toThrow(/unexpected documentation source/);
		const withoutMarkers = example().replaceAll('preset-tonal', 'preset-foo');
		expect(() => check(withoutMarkers, lock(withoutMarkers))).toThrow(/supported-major marker/);
	});

	it('checks the pinned offline references on release without modifying them', () => {
		const workflow = read('.github/workflows/publish.yml');
		const release = read('docs/RELEASE.md');
		expect(workflow).toContain('node scripts/check-release-docs.mjs --check-upstream');
		expect(workflow).toContain('if [ -f packages/svforge/docs/llms-snapshots.json ]; then');
		expect(workflow).toContain('Check pinned agent documentation before canary publication');
		expect(release).toContain('llms-snapshots.json');
		expect(release).toContain('90 days');
	});

	it('does not keep unused README screenshots', () => {
		expect(read('README.md')).not.toContain('docs/screenshots/');
		for (const file of ['dashboard.png', 'login.png', 'users.png']) {
			expect(existsSync(join(root, 'docs/screenshots', file))).toBe(false);
		}
	});
});
