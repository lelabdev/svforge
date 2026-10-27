/**
 * Load a module from a GENERATED or TEMPORARY project (#656).
 *
 * Several suites materialise a scaffold, a render harness or a compiled plugin
 * in a temporary directory and then import it. Those paths are produced by the
 * test itself and never point at `packages/<workspace>/dist/**`, but a plain
 * `await import(pathVariable)` is indistinguishable from loading a compiled
 * package by static analysis.
 *
 * Funnelling those loads through this one helper keeps the scoped-build
 * dependency model honest: the helper is a bounded, specific dependency
 * (recognised by `scripts/affected-scope.mjs`), while every OTHER statement and
 * import of the calling test is still analysed. Using this helper never marks a
 * file as artifact-free by itself.
 */
import { pathToFileURL } from 'node:url';

export interface ImportGeneratedOptions {
	/**
	 * Append a unique query so a rewritten file is re-evaluated instead of served
	 * from the ES module cache. Tests that previously appended `?test=<ts>` must
	 * keep that behaviour.
	 */
	bust?: boolean;
}

export async function importGenerated<T = unknown>(
	file: string,
	options: ImportGeneratedOptions = {}
): Promise<T> {
	const url = pathToFileURL(file).href;
	const specifier = options.bust ? `${url}?test=${Date.now()}-${Math.random()}` : url;
	return (await import(/* @vite-ignore */ specifier)) as T;
}
