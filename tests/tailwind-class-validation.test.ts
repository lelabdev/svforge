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

async function lintMarkup(markup: string) {
	const [result] = await eslint.lintText(markup, { filePath: fixturePath });
	return result.messages;
}

const invalidUtility = 'hover:bg-surface-50-900';
const utilityDiagnostics = (messages: Awaited<ReturnType<typeof lintMarkup>>) =>
	messages.filter((message) => message.ruleId === 'tailwindcss/no-custom-classname');

describe('Tailwind/Skeleton utility validation (#482)', () => {
	it('rejects utilities the actual Tailwind + Skeleton design system does not generate', async () => {
		const messages = utilityDiagnostics(
			await lintMarkup(`<div class="${invalidUtility}"></div>`)
		);

		expect(messages).toHaveLength(1);
		expect(messages[0].message).toContain(invalidUtility);
		expect(messages[0]).toMatchObject({ line: 1, column: 13 });
	}, 20_000);

	it('accepts generated Skeleton surface pairings with Tailwind variants', async () => {
		const messages = utilityDiagnostics(
			await lintMarkup(
				'<div class="bg-surface-50-950 text-surface-950-50 hover:bg-surface-100-900 focus-visible:bg-surface-200-800 md:bg-surface-50-950"></div>'
			)
		);

		expect(messages).toEqual([]);
	}, 20_000);

	it.each(['cn', 'clsx', 'twMerge'])('validates static classes passed through %s()', async (helper) => {
		const valid = utilityDiagnostics(
			await lintMarkup(
				`<div class={${helper}('flex items-center', condition && 'bg-surface-50-950')}></div>`
			)
		);
		const invalid = utilityDiagnostics(
			await lintMarkup(
				`<div class={${helper}('flex items-center', condition && '${invalidUtility}')}>
				</div>`
			)
		);

		expect(valid).toEqual([]);
		expect(invalid.map((message) => message.message)).toEqual([
			expect.stringContaining(invalidUtility)
		]);
	}, 20_000);

	it('reports invalid static utilities inside Svelte template literals', async () => {
		const messages = utilityDiagnostics(
			await lintMarkup(
				"<div class={`flex items-center ${active ? '" + invalidUtility + "' : 'hidden'}`}></div>"
			)
		);

		expect(messages).toHaveLength(1);
		expect(messages[0].message).toContain(invalidUtility);
	}, 20_000);
});
