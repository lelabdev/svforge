import { describe, expect, it } from 'vitest';
import { createCliPrompt } from '../packages/svforge/bin/prompts.mjs';

function scriptedPrompt(answers: string[]) {
	const output: string[] = [];
	const questions: string[] = [];
	const prompt = createCliPrompt(
		async (question: string) => {
			questions.push(question);
			const response = answers.shift();
			if (response === undefined) throw new Error(`Unexpected prompt: ${question}`);
			return response;
		},
		(message: string) => output.push(message)
	);
	return { prompt, output, questions };
}

describe('shipped CLI interactive prompt choices (#578)', () => {
	it('shows human-readable testing labels and returns the selected primitive profile', async () => {
		const { prompt, output } = scriptedPrompt(['2']);
		const selected = await prompt.select('Which testing profile?', [
			{ value: 'vitest', label: 'Vitest — unit and server behavior tests' },
			{ value: 'playwright', label: 'Playwright — Vitest plus full browser tests' }
		]);
		expect(selected).toBe('playwright');
		expect(output).toEqual([
			'Which testing profile?',
			'  1. Vitest — unit and server behavior tests',
			'  2. Playwright — Vitest plus full browser tests'
		]);
		expect(output.join('\n')).not.toContain('[object Object]');
	});

	it('defaults to the first value and supports template, package manager and hook choices', async () => {
		const { prompt } = scriptedPrompt(['', '1', '2']);
		expect(await prompt.select('Which template?', [
			{ value: 'base', label: 'Base' },
			{ value: 'dashboard', label: 'Dashboard' }
		])).toBe('base');
		expect(await prompt.select('Package manager?', [
			{ value: 'bun', label: 'Bun' },
			{ value: 'npm', label: 'npm' }
		])).toBe('bun');
		expect(await prompt.select('Git hooks?', [
			{ value: 'none', label: 'None' },
			{ value: 'lefthook', label: 'Lefthook' }
		])).toBe('lefthook');
	});

	it('returns module identifiers, including the special all-modules value', async () => {
		const { prompt, output } = scriptedPrompt(['1, 3']);
		const selected = await prompt.multiselect('Which modules?', [
			{ value: 'blog', label: 'Blog — publish articles' },
			{ value: 'dnd', label: 'DnD — sortable lists' },
			{ value: '__all__', label: 'All modules — complete stack' }
		]);
		expect(selected).toEqual(['blog', '__all__']);
		expect(selected.includes('__all__')).toBe(true);
		expect(output).toContain('  3. All modules — complete stack');
		expect(output.join('\n')).not.toContain('[object Object]');
	});

	it('supports no modules, discards out-of-range selections, and retains plain-string options', async () => {
		const { prompt } = scriptedPrompt(['', '1,2,0,12,x', '2']);
		expect(await prompt.multiselect('Modules?', [{ value: 'blog', label: 'Blog' }])).toEqual([]);
		expect(await prompt.multiselect('Modules?', ['blog', 'dnd'])).toEqual(['blog', 'dnd']);
		expect(await prompt.select('Package manager?', ['bun', 'npm'])).toBe('npm');
	});

	it('preserves input/default behavior for text and confirmations', async () => {
		const { prompt, questions } = scriptedPrompt(['', 'y', 'no']);
		expect(await prompt.text('Project directory?', 'my-app')).toBe('my-app');
		expect(await prompt.confirm('Continue?')).toBe(true);
		expect(await prompt.confirm('Continue?')).toBe(false);
		expect(questions).toEqual(['Project directory? [my-app] ', 'Continue? [y/N] ', 'Continue? [y/N] ']);
	});
});
