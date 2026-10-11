import { describe, expect, it } from 'vitest';
import { ensureCanaryStagingTags, promoteCanaryDistTag, removeCanaryStagingTags } from '../scripts/canary-dist-tags.mjs';

type NpmCall = (args: string[]) => { status: number; stdout: string; stderr: string };

function plan() {
	return {
		runId: '123',
		snapshotTag: 'canary-abcdef012345-123',
		stagingDistTag: 'canary-run-123',
		distTag: 'canary',
		candidates: [
			{ name: '@svforge/addon', version: '0.0.0-canary-abcdef012345-123', snapshot: true },
			{ name: 'svforge', version: '0.0.0-canary-abcdef012345-123', snapshot: true }
		]
	};
}

describe('canary npm dist-tags (#563)', () => {
	it('stages and promotes only validated snapshots without changing latest', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '0.0.0-canary-old' }],
			['svforge', { latest: '2.1.2' }]
		]);
		const calls: string[][] = [];
		const npm: NpmCall = (args) => {
			calls.push(args);
			if (args[0] === 'view' && args[2] === 'version') return { status: 0, stdout: JSON.stringify(args[1].split('@').slice(-1)[0]), stderr: '' };
			if (args[0] === 'view') return { status: 0, stdout: JSON.stringify(tags.get(args[1]) ?? {}), stderr: '' };
			if (args[0] === 'dist-tag' && args[1] === 'add') {
				const at = args[2].lastIndexOf('@');
				const name = args[2].slice(0, at);
				const version = args[2].slice(at + 1);
				const current = tags.get(name) ?? {};
				current[args[3]] = version;
				tags.set(name, current);
				return { status: 0, stdout: '', stderr: '' };
			}
			if (args[0] === 'dist-tag' && args[1] === 'rm') {
				delete tags.get(args[2])?.[args[3]];
				return { status: 0, stdout: '', stderr: '' };
			}
			return { status: 1, stdout: '', stderr: 'unexpected' };
		};

		ensureCanaryStagingTags(plan(), npm);
		promoteCanaryDistTag(plan(), npm);
		removeCanaryStagingTags(plan(), npm);
		expect(tags.get('@svforge/addon')).toEqual({ latest: '2.3.0', canary: '0.0.0-canary-abcdef012345-123' });
		expect(tags.get('svforge')).toEqual({ latest: '2.1.2', canary: '0.0.0-canary-abcdef012345-123' });
		expect(calls.some((args) => args.includes('latest'))).toBe(false);
	});

	it('refuses a delayed older dispatch without rolling back any newer canary pointer', () => {
		const newerVersion = '0.0.0-canary-fedcba987654-999';
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: newerVersion }],
			['svforge', { latest: '2.1.2', canary: '0.0.0-canary-abcdef012345-122' }]
		]);
		const writes: string[][] = [];
		const npm: NpmCall = (args) => {
			if (args[0] === 'view' && args[2] === 'version') {
				return { status: 0, stdout: JSON.stringify(args[1].split('@').slice(-1)[0]), stderr: '' };
			}
			if (args[0] === 'view') {
				return { status: 0, stdout: JSON.stringify(tags.get(args[1]) ?? {}), stderr: '' };
			}
			writes.push(args);
			return { status: 0, stdout: '', stderr: '' };
		};
		expect(() => promoteCanaryDistTag(plan(), npm)).toThrow(/refusing to replace newer canary/i);
		expect(writes).toHaveLength(0);
		expect(tags.get('@svforge/addon')?.canary).toBe(newerVersion);
		expect(tags.get('svforge')?.canary).toBe('0.0.0-canary-abcdef012345-122');
	});

	it('restores the prior canary tags if promotion partially fails', () => {
		const tags = new Map<string, Record<string, string>>([
			['@svforge/addon', { latest: '2.3.0', canary: '0.0.0-canary-old' }],
			['svforge', { latest: '2.1.2' }]
		]);
		let failed = false;
		const npm: NpmCall = (args) => {
			if (args[0] === 'view' && args[2] === 'version') return { status: 0, stdout: JSON.stringify(args[1].split('@').slice(-1)[0]), stderr: '' };
			if (args[0] === 'view') return { status: 0, stdout: JSON.stringify(tags.get(args[1]) ?? {}), stderr: '' };
			if (args[0] === 'dist-tag' && args[1] === 'add') {
				const at = args[2].lastIndexOf('@');
				const name = args[2].slice(0, at);
				if (args[3] === 'canary' && name === 'svforge' && !failed) {
					failed = true;
					return { status: 1, stdout: '', stderr: 'temporary registry failure' };
				}
				const version = args[2].slice(at + 1);
				const current = tags.get(name) ?? {};
				current[args[3]] = version;
				tags.set(name, current);
				return { status: 0, stdout: '', stderr: '' };
			}
			if (args[0] === 'dist-tag' && args[1] === 'rm') {
				delete tags.get(args[2])?.[args[3]];
				return { status: 0, stdout: '', stderr: '' };
			}
			return { status: 1, stdout: '', stderr: 'unexpected' };
		};

		expect(() => promoteCanaryDistTag(plan(), npm)).toThrow(/previous canary tags were restored/i);
		expect(tags.get('@svforge/addon')?.canary).toBe('0.0.0-canary-old');
		expect(tags.get('svforge')?.canary).toBeUndefined();
		expect(tags.get('svforge')?.latest).toBe('2.1.2');
	});
});
