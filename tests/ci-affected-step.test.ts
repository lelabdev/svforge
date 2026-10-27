import { describe, expect, it } from 'vitest';
import { planCiSteps, renderGithubOutputs } from '../scripts/ci/affected-step.mjs';

/**
 * #570 phase B — conservative activation.
 *
 * The plan must never narrow a full-scope resolver result, must keep tests-only
 * safe (build all because a changed test can import a built package), and only
 * scopes workspace builds/tests behind the explicit `ci:targeted` opt-in.
 */
const targetedScope = {
	global: false,
	mode: 'targeted',
	docsOnly: false,
	releaseSensitive: false,
	reasons: [],
	packages: [{ name: '@svforge/dnd', dir: 'dnd' }, { name: 'svforge', dir: 'svforge' }],
	buildOrder: [{ name: '@svforge/addon-kit', dir: 'addon-kit' }, { name: '@svforge/dnd', dir: 'dnd' }, { name: 'svforge', dir: 'svforge' }],
	// Dist-free files only: the model is what decides whether a scoped build is safe.
	tests: { mode: 'selected', files: ['tests/scaffold-paths.test.ts', 'tests/blog-date.test.ts'] }
};
const docsScope = {
	global: false,
	mode: 'none',
	docsOnly: true,
	packages: [],
	buildOrder: [],
	tests: { mode: 'none', files: [] }
};
const testsScope = {
	global: false,
	mode: 'tests',
	docsOnly: false,
	packages: [],
	buildOrder: [],
	tests: { mode: 'selected', files: ['tests/cli-create.test.ts'] }
};
const fullScope = {
	global: true,
	mode: 'full',
	docsOnly: false,
	packages: [{ name: 'svforge', dir: 'svforge' }],
	buildOrder: [],
	tests: { mode: 'all', files: [] }
};

describe('CI scope plan (#570 phase B)', () => {
	it('runs everything for a full-scope resolver result', () => {
		expect(planCiSteps(fullScope)).toMatchObject({ build: 'all', tests: 'all' });
	});

	it('skips build/tests for documentation or generated-artifact-only changes', () => {
		expect(planCiSteps(docsScope)).toMatchObject({ build: 'none', tests: 'none', reason: expect.stringContaining('documentation') });
	});

	it('builds everything but runs only the changed tests for tests-only changes', () => {
		// A changed test may import a built workspace package.
		expect(planCiSteps(testsScope)).toMatchObject({ build: 'all', tests: 'selected', testFiles: ['tests/cli-create.test.ts'] });
	});

	it('keeps workspace changes on full validation until ci:targeted is requested', () => {
		const plan = planCiSteps(targetedScope);
		expect(plan).toMatchObject({ build: 'all', tests: 'all', mode: 'targeted' });
		expect(plan.reason).toContain('ci:targeted');
	});

	it('scopes the build when the selected tests have no built-artifact consumer', () => {
		// #656: with the dist-dependency model, a selection that only imports
		// sources (or scripts) can build the affected closure instead of everything.
		const plan = planCiSteps(targetedScope, { targeted: true });
		expect(plan.build).toBe('selected');
		expect(plan.buildDirs).toEqual(['addon-kit', 'dnd', 'svforge']);
		expect(plan.tests).toBe('selected');
		expect(plan.testFiles).toEqual(targetedScope.tests.files);
		expect(plan.deferredTestFiles).toEqual([]);
		expect(plan.reason).toContain('scoped build');
	});

	it('escalates to a full build when ANY selected test needs every workspace (#656 B-01)', () => {
		// A scoped build must never become a green required check with tests left
		// out: one unbounded selection escalates the whole run.
		const plan = planCiSteps(
			{ ...targetedScope, tests: { mode: 'selected', files: ['tests/blog-date.test.ts', 'tests/structure.test.ts', 'tests/addon-packaging.test.ts'] } },
			{ targeted: true }
		);
		expect(plan).toMatchObject({ build: 'all', buildDirs: [], tests: 'all', testFiles: [], deferredTestFiles: [] });
		expect(plan.reason).toContain('full build');
		expect(plan.reason).toContain('tests/addon-packaging.test.ts');
	});

	it('falls back to a full build when no selected test is runnable under a scoped build', () => {
		const plan = planCiSteps(
			{ ...targetedScope, tests: { mode: 'selected', files: ['tests/addon-packaging.test.ts', 'tests/user-journey.test.ts'] } },
			{ targeted: true }
		);
		expect(plan).toMatchObject({ build: 'all', tests: 'all', buildDirs: [], deferredTestFiles: [] });
	});

	it('never runs a selected test against a build set it cannot use', () => {
		// The #570 phase-C failure mode: structure/cli-create/package-entry and the
		// packaging/journey guards inspect every workspace dist. Selecting one of
		// them together with a bounded test must run BOTH under a full build.
		for (const file of [
			'tests/addon-packaging.test.ts',
			'tests/user-journey.test.ts',
			'tests/real-bin.test.ts',
			'tests/changesets.test.ts',
			'tests/package-entry.test.ts'
		]) {
			const plan = planCiSteps(
				{ ...targetedScope, tests: { mode: 'selected', files: ['tests/blog-date.test.ts', file] } },
				{ targeted: true }
			);
			expect(plan.build, `${file} must force a full build`).toBe('all');
			expect(plan.tests).toBe('all');
			expect(plan.deferredTestFiles).toEqual([]);
		}
	});

	it('escalates when a selected test needs a workspace outside the scoped order', () => {
		const plan = planCiSteps(
			{ ...targetedScope, tests: { mode: 'selected', files: ['tests/blog-date.test.ts'] }, buildOrder: [{ name: '@svforge/dnd', dir: 'dnd' }] },
			{ targeted: true }
		);
		// blog-date imports the blog template source, not a built package: no
		// requirement → the reduced order is kept (never silently widened).
		expect(plan.build).toBe('selected');
		expect(plan.buildDirs).toEqual(['dnd']);
	});

	it('never selects an empty test run: an empty selection falls back to all tests', () => {
		const plan = planCiSteps({ ...targetedScope, tests: { mode: 'selected', files: [] } }, { targeted: true });
		expect(plan.tests).toBe('all');
		expect(plan.testFiles).toEqual([]);
	});

	it('renders stable GitHub outputs', () => {
		const plan = planCiSteps(targetedScope, { targeted: true });
		const lines = renderGithubOutputs(plan).trim().split('\n');
		expect(lines.slice(0, 5)).toEqual([
			'mode=targeted',
			'build=selected',
			'build_dirs=addon-kit dnd svforge',
			'tests=selected',
			'test_files=tests/scaffold-paths.test.ts tests/blog-date.test.ts'
		]);
		expect(lines[5]).toContain('deferred_test_files=');
		expect(lines[6]).toContain('ci:targeted');
	});
});
