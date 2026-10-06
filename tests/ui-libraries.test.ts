import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempProject } from './helpers';
import { buildManifest, renderLlmstxt } from '../packages/svforge/src/ai-context';
import { validateManifestShape } from '../packages/addon-kit/src/json';
import { checkDesignSystem, duplicatedSkeletonPrimitiveName } from '../packages/svforge/src/design-system';
import { registerUiLibrary, setPreferredUi } from '../packages/svforge/src/ui-libraries';
import { scaffoldedAgents } from '../packages/svforge/src/scaffolded-agents';

const PACKAGE = '@example/arbitrary-widgets';
const projects: Array<() => void> = [];

function project() {
	const temp = tempProject('sf-ui-choice');
	projects.push(temp.cleanup);
	writeFileSync(join(temp.dir, 'package.json'), JSON.stringify({ dependencies: { [PACKAGE]: '^1.0.0' } }));
	writeFileSync(join(temp.dir, '.svforge.json'), JSON.stringify(buildManifest('base', []), null, 2));
	writeFileSync(join(temp.dir, 'AGENTS.md'), `${scaffoldedAgents('base')}\n\n<!-- project-specific notes -->\n`);
	writeFileSync(join(temp.dir, 'llms.txt'), renderLlmstxt(buildManifest('base', [])));
	mkdirSync(join(temp.dir, 'src/routes'), { recursive: true });
	writeFileSync(
		join(temp.dir, 'src/routes/+page.svelte'),
		`<script>import { Dialog } from '${PACKAGE}';</script><Dialog />`
	);
	return temp.dir;
}

afterEach(() => {
	for (const cleanup of projects.splice(0)) cleanup();
});

describe('project-selected UI libraries (#480)', () => {
	it('keeps Skeleton as the default without declaring an external UI library', () => {
		const manifest = buildManifest('base', []);
		expect(manifest.ui).toEqual({ preferred: 'skeleton', libraries: [] });
		expect(renderLlmstxt(manifest)).toContain('Preferred UI strategy: skeleton');
		expect(renderLlmstxt(manifest)).toContain('do not add a UI library unless the user explicitly requests one');
	});

	it('warns about an imported but unregistered generic UI package without blocking checks', async () => {
		const root = project();
		const diagnostics = await checkDesignSystem(root);
		const notice = diagnostics.find((item) => item.message.includes(PACKAGE));
		expect(notice?.status).toBe('warn');
		expect(notice?.message).toContain(`svforge ui register ${PACKAGE}`);
		expect(diagnostics.some((item) => item.status === 'error')).toBe(false);
	});

	it('registers a generic library and component root idempotently, then refreshes guidance', () => {
		const root = project();
		registerUiLibrary(root, PACKAGE, 'src/lib/components/external');
		const firstManifest = readFileSync(join(root, '.svforge.json'), 'utf8');
		registerUiLibrary(root, PACKAGE, 'src/lib/components/external');
		expect(readFileSync(join(root, '.svforge.json'), 'utf8')).toBe(firstManifest);

		const manifest = JSON.parse(firstManifest);
		expect(manifest.ui).toEqual({
			preferred: 'skeleton',
			libraries: [{ package: PACKAGE, componentRoots: ['src/lib/components/external'] }]
		});
		const context = readFileSync(join(root, 'llms.txt'), 'utf8');
		expect(context).toContain(`- ${PACKAGE}`);
		expect(context).toContain('src/lib/components/external');
		expect(context).toContain('remove or replace a project-selected UI library');
		const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
		expect(agents).toContain('Preferred UI strategy: `skeleton`.');
		expect(agents).toContain(`\`${PACKAGE}\``);
		expect(agents).toContain('<!-- project-specific notes -->');
	});

	it('allows a registered package to become the preferred UI strategy', () => {
		const root = project();
		registerUiLibrary(root, PACKAGE);
		setPreferredUi(root, PACKAGE);
		const manifest = JSON.parse(readFileSync(join(root, '.svforge.json'), 'utf8'));
		expect(manifest.ui.preferred).toBe(PACKAGE);
		expect(readFileSync(join(root, 'llms.txt'), 'utf8')).toContain(`Preferred UI strategy: ${PACKAGE}`);
	});

	it('exempts only explicitly registered component roots from Skeleton duplicate checks', async () => {
		const root = project();
		const externalRoot = join(root, 'src/lib/components/external');
		mkdirSync(externalRoot, { recursive: true });
		const dialogFile = join(externalRoot, 'Dialog.svelte');
		writeFileSync(dialogFile, '<div>External Dialog implementation</div>');

		expect(duplicatedSkeletonPrimitiveName(dialogFile, root)).toBe('Dialog');
		registerUiLibrary(root, PACKAGE, 'src/lib/components/external');
		expect(duplicatedSkeletonPrimitiveName(dialogFile, root)).toBeNull();
		const diagnostics = await checkDesignSystem(root);
		expect(diagnostics.some((item) => item.message.includes('Duplicated Skeleton primitive "Dialog"'))).toBe(false);
	});

	it('keeps the delivered checker non-blocking and applies registered source-root exemptions', async () => {
		const root = project();
		const { baseRootFiles } = await import('../packages/svforge/src/templates');
		writeFileSync(join(root, 'svforge-check.mjs'), baseRootFiles['/svforge-check.mjs']);
		const firstRun = execFileSync('node', ['svforge-check.mjs'], { cwd: root, encoding: 'utf8' });
		expect(firstRun).toContain(`WARN: UI component package "${PACKAGE}"`);
		expect(firstRun).not.toContain('ERROR: Second UI kit');

		const componentRoot = join(root, 'src/lib/components/external');
		mkdirSync(componentRoot, { recursive: true });
		writeFileSync(join(componentRoot, 'Dialog.svelte'), '<div>Selected library component</div>');
		const manifest = JSON.parse(readFileSync(join(root, '.svforge.json'), 'utf8'));
		manifest.ui.libraries = [{ package: PACKAGE, componentRoots: ['src/lib/components/external'] }];
		writeFileSync(join(root, '.svforge.json'), JSON.stringify(manifest, null, 2));
		const secondRun = execFileSync('node', ['svforge-check.mjs'], { cwd: root, encoding: 'utf8' });
		expect(secondRun).not.toContain('WARN: UI component package');
		expect(secondRun).not.toContain('Duplicated Skeleton primitive "Dialog"');

		manifest.ui.libraries[0].componentRoots = ['src'];
		writeFileSync(join(root, '.svforge.json'), JSON.stringify(manifest, null, 2));
		const featureRoot = join(root, 'src/lib/features');
		mkdirSync(featureRoot, { recursive: true });
		writeFileSync(join(featureRoot, 'Dialog.svelte'), '<div>ordinary project dialog</div>');
		const forgedBroadRoot = spawnSync('node', ['svforge-check.mjs'], { cwd: root, encoding: 'utf8' });
		expect(forgedBroadRoot.status).toBe(1);
		expect(forgedBroadRoot.stdout).toContain('Duplicated Skeleton primitive "Dialog"');
	});

	it('manifest validation rejects roots that are unsafe or too broad', () => {
		for (const componentRoot of ['.', 'src', 'src/lib', 'src/lib/components', 'src/lib/components/ui', 'src/lib/components/svforge', '../outside']) {
			const manifest = buildManifest('base', []);
			manifest.ui.libraries = [{ package: PACKAGE, componentRoots: [componentRoot] }];
			expect(validateManifestShape(manifest, '.svforge.json').join(' '), componentRoot).toContain('narrow directories');
		}
		const valid = buildManifest('base', []);
		valid.ui.libraries = [{ package: PACKAGE, componentRoots: ['src/lib/components/external'] }];
		expect(validateManifestShape(valid, '.svforge.json')).toEqual([]);
	});

	it('rejects broad roots and leaves all project guidance files untouched on multi-root failure', () => {
		const root = project();
		const paths = ['.svforge.json', 'llms.txt', 'AGENTS.md'];
		const before = new Map(paths.map((file) => [file, readFileSync(join(root, file), 'utf8')]));
		for (const componentRoot of ['.', 'src', 'src/lib', 'src/lib/components', 'src/lib/components/ui', 'src/lib/components/svforge']) {
			expect(() => registerUiLibrary(root, PACKAGE, componentRoot), componentRoot).toThrow(/narrow directory/);
		}
		expect(() => registerUiLibrary(root, PACKAGE, ['src/lib/components/valid', 'src'])).toThrow(/narrow directory/);
		for (const file of paths) expect(readFileSync(join(root, file), 'utf8'), file).toBe(before.get(file));
	});
});
