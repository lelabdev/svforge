import { describe, expect, it } from 'vitest';
import { ensureCanaryStagingTags, promoteCanaryDistTag, removeCanaryStagingTags } from '../scripts/canary-dist-tags.mjs';

type NpmCall = (args: string[]) => { status: number; stdout: string; stderr: string };

function plan() {
	return {
		runId: '123',
		snapshotTag: 'canary-abcdef012345-123',
		iteration: 1,
		stagingDistTag: 'canary-run-123',
		distTag: 'canary',
		candidates: [
			{ name: '@svforge/addon', version: '3.0.0-canary.1', snapshot: true },
			{ name: 'svforge', version: '2.2.1-canary.1', snapshot: true }
		]
	};
}

function mockNpm(tags: Map<string, Record<string, string>>, failWrite?: (name: string, tag: string) => boolean) {
	const calls: string[][] = [];
	const npm: NpmCall = (args) => {
		calls.push(args);
		if (args[0] === 'view' && args[2] === 'version') {
			return { status: 0, stdout: JSON.stringify(args[1].slice(args[1].lastIndexOf('@') + 1)), stderr: '' };
		}
		if (args[0] === 'view') return { status: 0, stdout: JSON.stringify(tags.get(args[1]) ?? {}), stderr: '' };
		if (args[0] === 'dist-tag' && args[1] === 'add') {
			const at = args[2].lastIndexOf('@');
			const name = args[2].slice(0, at);
			const version = args[2].slice(at + 1);
			if (failWrite?.(name, args[3])) return { status: 1, stdout: '', stderr: 'temporary registry failure' };
			const current = tags.get(name) ?? {};
			current[args[3]] = version;
			tags.set(name, current);
			return { status: 0, stdout: '', stderr: '' };
		}
		if (args[0] === 'dist-tag' && args[1] === 'rm') {
			delete tags.get(args[2])?.[args[3]];
			return { status: 0, stdout: '', stderr: '' };
		}
		return { status: 1, stdout: '', stderr: 'unexpected npm command' };
	};
	return { npm, calls };
}

describe('numbered canary npm dist-tags (#572)', () => {
	it('stages, promotes only canary, and cleans up without moving latest or dev', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '0.0.0-canary-legacy', dev: '0.0.0-canary-older' }],
			['svforge', { latest: '2.1.2' }]
		]);
		const { npm, calls } = mockNpm(tags);
		ensureCanaryStagingTags(plan(), npm);
		promoteCanaryDistTag(plan(), npm);
		removeCanaryStagingTags(plan(), npm);
		expect(tags.get('@svforge/addon')).toEqual({ latest: '2.3.0', canary: '3.0.0-canary.1', dev: '0.0.0-canary-older' });
		expect(tags.get('svforge')).toEqual({ latest: '2.1.2', canary: '2.2.1-canary.1' });
		expect(calls.some((args) => args.includes('latest') || (args[0] === 'dist-tag' && args.includes('dev')))).toBe(false);
	});

	it('refuses a delayed canary if an existing public numbered version is newer', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '3.0.0-canary.5' }],
			['svforge', { latest: '2.1.2', canary: '2.2.1-canary.4' }]
		]);
		const { npm, calls } = mockNpm(tags);
		expect(() => promoteCanaryDistTag(plan(), npm)).toThrow(/refusing to replace newer canary/i);
		expect(calls.filter((x) => x[0] === 'dist-tag')).toHaveLength(0);
		expect(tags.get('@svforge/addon')?.canary).toBe('3.0.0-canary.5');
	});

	it('does not downgrade from a newer prospective minor to a prior patch canary', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '3.1.0-canary.1' }],
			['svforge', { latest: '2.1.2' }]
		]);
		const { npm } = mockNpm(tags);
		expect(() => promoteCanaryDistTag(plan(), npm)).toThrow(/refusing to replace newer canary/i);
	});

	it('restores previous canary pointers on partial promotion failure', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '3.0.0-canary.0', dev: '0.0.0-canary-old' }],
			['svforge', { latest: '2.1.2' }]
		]);
		let failed = false;
		const { npm } = mockNpm(tags, (name, tag) => {
			if (name === 'svforge' && tag === 'canary' && !failed) {
				failed = true;
				return true;
			}
			return false;
		});
		expect(() => promoteCanaryDistTag(plan(), npm)).toThrow(/previous public tags were restored/i);
		expect(tags.get('@svforge/addon')).toEqual({ latest: '2.3.0', canary: '3.0.0-canary.0', dev: '0.0.0-canary-old' });
		expect(tags.get('svforge')).toEqual({ latest: '2.1.2' });
	});
});
