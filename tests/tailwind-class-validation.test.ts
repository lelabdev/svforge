import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

// The repository normally ignores scaffold templates in its generic lint
// pass; run this scoped fixture with ignores disabled to exercise the explicit
// Svelte-template lint configuration used by `bun run lint`.
const eslint = new ESLint({ cwd: ROOT, ignore: false });
const fixturePath = join(
	ROOT,
	'packages/svforge/templates/base/src/lib/components/__lint_fixture.svelte'
);

async function lintClass(className: string) {
	const [result] = await eslint.lintText(`<div class="${className}"></div>`, {
		filePath: fixturePath
	});
	return result.messages;
}

describe('Tailwind/Skeleton utility validation (#482)', () => {
	it('rejects utilities the actual Tailwind + Skeleton design system does not generate', async () => {
		const messages = await lintClass('hover:bg-surface-50-900');

		expect(messages.map((message) => message.ruleId)).toContain(
			'tailwindcss/no-custom-classname'
		);
		expect(messages.find((message) => message.ruleId === 'tailwindcss/no-custom-classname')?.message)
			.toContain('hover:bg-surface-50-900');
	}, 20_000);

	it('accepts generated Skeleton surface pairings with Tailwind variants', async () => {
		const messages = await lintClass(
			'bg-surface-50-950 hover:bg-surface-100-900 focus:bg-surface-200-800 md:bg-surface-50-950'
		);

		expect(messages.filter((message) => message.ruleId === 'tailwindcss/no-custom-classname')).toEqual(
			[]
		);
	}, 20_000);
});
