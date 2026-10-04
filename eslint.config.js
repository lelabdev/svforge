import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tailwindcss from 'eslint-plugin-tailwindcss';

const templateSvelteFiles = [
	'packages/*/templates/src/**/*.svelte',
	'packages/svforge/templates/*/src/**/*.svelte'
];
const svelteParser = svelte.configs.base.find((config) => config.files?.includes('**/*.svelte'))
	.languageOptions.parser;

export default tseslint.config(
	{
		// The generic repository pass excludes scaffold sources; the dedicated
		// Tailwind/Svelte pass below targets their static class candidates.
		// tests/__gen__/ holds generated fixtures.
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/templates/**/*',
			'**/docs/**',
			'**/*.md',
			'tests/__gen__/**'
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts', '**/*.mts', '**/*.mjs'],
		languageOptions: {
			globals: {
				...globals.node
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
			],
			'@typescript-eslint/no-require-imports': 'error'
		}
	},
	{
		// Deliberate exception: doctor.ts runs under Bun, which supports
		// require() inside ESM. Each diagnostic performs its own local
		// require so a missing module fails in isolation instead of breaking
		// the whole doctor run.
		files: ['packages/svforge/src/doctor.ts'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off'
		}
	},
	{
		files: templateSvelteFiles,
		plugins: { svelte, tailwindcss },
		linterOptions: { reportUnusedDisableDirectives: 'off' },
		languageOptions: {
			parser: svelteParser,
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				parser: tseslint.parser,
				extraFileExtensions: ['.svelte']
			}
		},
		settings: {
			tailwindcss: {
				cssConfigPath: `${import.meta.dirname}/packages/svforge/templates/base/src/routes/layout.css`
			}
		},
		rules: {
			// This pass validates classes only; each package's own lint config
			// remains responsible for its unrelated TypeScript/Svelte rules.
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'tailwindcss/no-custom-classname': 'error'
		}
	},
	{
		// Deliberate exception for test files only: tests intentionally use
		// loose types when inspecting generated output and synchronous
		// require() to load compiled fixtures. Production code keeps the
		// strict rules above.
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off'
		}
	}
);
