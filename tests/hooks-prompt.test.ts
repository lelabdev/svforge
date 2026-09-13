import { describe, it, expect } from 'vitest';

/**
 * Tests for #416 — the interactive hooks choice must explain its practical
 * consequences before the user answers, and the generated next steps must
 * show the equivalent manual check with the SELECTED package manager.
 *
 * Meanings are asserted by substring — never byte-for-byte paragraphs.
 */

const addon = (await import('../packages/svforge/src/index')).default;

interface AddonOption {
	value: string;
	label: string;
}
interface HooksOption {
	question: string;
	default: string;
	options: AddonOption[];
}

function hooksOption(): HooksOption {
	return (addon.options as Record<string, HooksOption>).hooks;
}

function nextSteps(hooks: 'none' | 'lefthook', packageManager = 'npm@10.9.0'): string {
	const render = addon.nextSteps as (ctx: unknown) => string[];
	return render({
		options: { template: 'base', testing: 'vitest', hooks },
		packageManager,
		cwd: process.cwd()
	}).join('\n');
}

describe('hooks option wording (#416)', () => {
	it('states that the check runs before Git commits', () => {
		expect(hooksOption().question).toMatch(/before Git commits/i);
	});

	it('None means no automatic commit check', () => {
		expect(hooksOption().options.find((o) => o.value === 'none')!.label).toMatch(/no automatic commit check/i);
	});

	it('Lefthook states that errors and warnings may block a commit', () => {
		const label = hooksOption().options.find((o) => o.value === 'lefthook')!.label;
		expect(label).toMatch(/block/i);
		expect(label).toMatch(/error/i);
		expect(label).toMatch(/warning/i);
	});

	it('default stays none — the hook remains opt-in (#344)', () => {
		expect(hooksOption().default).toBe('none');
	});
});

describe('next steps for the hooks choice (#416)', () => {
	it('explains the consequence and the removal path when Lefthook is chosen', () => {
		const lines = nextSteps('lefthook');
		expect(lines).toMatch(/svforge-check\.mjs --strict/);
		expect(lines).toMatch(/development safeguard/i);
		expect(lines).toMatch(/remove/i);
	});

	it('shows the strict manual check for the SELECTED package manager — never another one', () => {
		const npmLines = nextSteps('lefthook', 'npm@10.9.0');
		expect(npmLines).toMatch(/npm run check/);
		expect(npmLines).not.toMatch(/bun run check/);

		const bunLines = nextSteps('lefthook', 'bun@1.2.0');
		expect(bunLines).toMatch(/bun run check/);
		expect(bunLines).not.toMatch(/npm run check/);
	});

	it('tells a None user the check stays available manually and nothing is required', () => {
		const lines = nextSteps('none');
		expect(lines).toMatch(/no automatic commit check/i);
		expect(lines).toMatch(/manual/i);
	});
});
