/**
 * @no-built-artifacts: reads only the build plan produced by the affected-scope resolver.
 * Build scope of the current run (#656).
 *
 * Repository guards that inspect BUILT output (`dist/index.js`, add-on option
 * registries, package entries) used to demand every workspace's `dist`, which
 * made any scoped CI build impossible. They now verify the invariant over the
 * run's declared build set:
 *
 * - locally, in a full scaffold or when CI did not scope the build, the
 *   environment variable is absent → the scope is EVERY workspace (unchanged
 *   behaviour);
 * - with `ci:targeted`, CI exports the plan's build directories, so the guards
 *   check exactly the packages this run compiled.
 *
 * The variable is validated: an unknown directory throws instead of silently
 * shrinking the guard, and the built set must never be empty.
 */
import { loadWorkspaces } from '../../scripts/affected-scope.mjs';

export interface BuildScope {
	/** `all` when unscoped/full, `selected` for a scoped CI build. */
	mode: 'all' | 'selected';
	/** Workspace directories (package folder names) to verify. */
	dirs: string[];
}

const ENV_VARIABLE = 'SVFORGE_BUILD_WORKSPACES';

/** Parse the declared build scope. Throws on unknown or empty selections. */
export function buildScope(raw: string | undefined = process.env[ENV_VARIABLE]): BuildScope {
	const workspaces = loadWorkspaces(process.cwd());
	const knownDirs = new Set(workspaces.map((workspace) => workspace.dir));
	const value = (raw ?? '').trim();
	if (value === '' || value === 'all') {
		return { mode: 'all', dirs: workspaces.map((workspace) => workspace.dir).sort() };
	}
	const dirs = [...new Set(value.split(/[\s,]+/).filter(Boolean))].sort();
	if (dirs.length === 0) {
		// A separator-only value (',' / ' , ') must not silently disable guards.
		throw new Error(
			`${ENV_VARIABLE} is set to "${raw}" but names no workspace. Use a space/comma separated list of package directories or "all".`
		);
	}
	const unknown = dirs.filter((dir) => !knownDirs.has(dir));
	if (unknown.length > 0) {
		throw new Error(
			`${ENV_VARIABLE} names unknown workspace(s): ${unknown.join(', ')}. ` +
				'Expected package directory names from scripts/affected-scope.mjs.'
		);
	}
	return { mode: 'selected', dirs };
}

/** Directories this run built (every workspace when unscoped). */
export function builtWorkspaceDirs(): string[] {
	return buildScope().dirs;
}

/** Whether one workspace directory was built in this run. */
export function isBuiltWorkspace(dir: string): boolean {
	return builtWorkspaceDirs().includes(dir);
}
