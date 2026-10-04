import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import type { SvApi } from 'sv';
import svelte from 'eslint-plugin-svelte';
import svforge from '../packages/svforge/templates/base/root/eslint-plugin-svforge.mjs';
import { baseFiles, baseRootFiles, dashboardFiles, dashboardRootFiles } from '../packages/svforge/src/templates';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import svforgeAddon from '../packages/svforge/src/index';

const eslint = new ESLint({
	overrideConfigFile: true,
	overrideConfig: [
		...svelte.configs.recommended,
		{
			files: ['**/*.{js,ts,svelte}'],
			plugins: { svforge },
			rules: { 'svforge/no-design-violations': 'error' }
		}
	]
});

describe('svforge ESLint design-system rule (#346)', () => {
	it('reports forbidden UI kit imports in JavaScript and TypeScript with the shared identifier', async () => {
		for (const filePath of ['eslint.config.js', 'src/lib/config.ts']) {
			const [message] = await eslint.lintText("import { Dialog } from 'bits-ui';", { filePath });
			expect(message.errorCount).toBe(1);
			expect(message.messages[0]).toMatchObject({
				ruleId: 'svforge/no-design-violations',
				messageId: 'forbiddenUiKit'
			});
			expect(message.messages[0].message).toContain('Second UI kit detected: bits-ui');
		}
	});

	it('reports a duplicated Skeleton primitive in Svelte at the component location', async () => {
		const [result] = await eslint.lintText('<div>custom dialog</div>', {
			filePath: 'src/lib/features/Dialog.svelte'
		});
		expect(result.errorCount).toBe(1);
		expect(result.messages[0]).toMatchObject({
			ruleId: 'svforge/no-design-violations',
			messageId: 'duplicatedSkeletonPrimitive',
			line: 1,
			column: 1
		});
		expect(result.messages[0].message).toContain('Duplicated Skeleton primitive "Dialog"');
	});
});

type FakeSv = {
	files: Map<string, string>;
	dependency: () => void;
	devDependency: () => void;
	file: (path: string, transform: (content: string) => string) => void;
};

function scaffoldFiles(template: 'base' | 'dashboard'): Map<string, string> {
	const sv: FakeSv = {
		files: new Map(),
		dependency: () => {},
		devDependency: () => {},
		file(path, transform) {
			const seed = this.files.get(path) ?? (path === 'package.json' ? '{"scripts":{}}' : '');
			this.files.set(path, transform(seed));
		}
	};
	const api = sv as unknown as SvApi;
	applyBaseMode(api, template === 'base' ? baseFiles : {}, baseRootFiles);
	if (template === 'dashboard') applyDashboardMode(api, baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);
	return sv.files;
}

describe('scaffolded ESLint configuration (#346)', () => {
	it.each(['base', 'dashboard'] as const)('writes the required svforge plugin config at the project root for %s', (template) => {
		const config = scaffoldFiles(template).get('eslint.config.js');
		expect(config).toContain("import svforge from './eslint-plugin-svforge.mjs';");
		expect(config).toContain("'svforge/no-design-violations': 'error'");
		expect(config).toContain("import tailwindcss from 'eslint-plugin-tailwindcss';");
		expect(config).toContain("cssConfigPath: 'src/routes/layout.css'");
		expect(config).toContain("'tailwindcss/no-custom-classname': 'error'");
		expect(config).not.toContain('whitelist');
		expect(config).not.toContain('try {');
		// #325: the advertised lint chain — prettier check runs BEFORE eslint,
		// and the .prettierignore (prebuild-generated from the delivery
		// manifests) keeps both tools off the upgrade-baseline-tracked files.
		expect(JSON.parse(scaffoldFiles(template).get('package.json')!).scripts.lint).toBe(
			'prettier --check . && eslint .'
		);
		expect(scaffoldFiles(template).get('.prettierignore')).toBeTruthy();
	});

	it('declares the Tailwind-aware plugin for generated projects', () => {
		const dependencies = new Map<string, string>();
		const files = new Map<string, string>();
		const sv = {
			dependency() {},
			devDependency(name: string, version: string) {
				dependencies.set(name, version);
			},
			file(path: string, transform: (content: string) => string) {
				const seed = files.get(path) ?? (path === 'package.json' ? '{"scripts":{}}' : '');
				files.set(path, transform(seed));
			}
		};

		svforgeAddon.run({
			sv: sv as never,
			options: { template: 'base', testing: 'vitest', hooks: 'none' },
			packageManager: 'bun'
		} as never);

		expect(dependencies.get('eslint-plugin-tailwindcss')).toBe('^4.4.0');
	});
});
