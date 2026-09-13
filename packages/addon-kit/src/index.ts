/**
 * @svforge/addon-kit — shared runtime for every @svforge/* addon package.
 *
 * One small dependency instead of thirteen divergent copies of the same
 * policies:
 *
 * - capabilities.ts (#323): the capability vocabulary, the per-module
 *   contracts, and the structural install gate used in the real `sv add`
 *   flow.
 * - json.ts (#324): strict, non-destructive planning of .svforge.json and
 *   messages/{locale}.json merges — invalid JSON fails the installation with
 *   a readable diagnostic BEFORE anything is written.
 */
export * from './capabilities';
export * from './resolve';
export * from './json';
export * from './patch';
export * from './upgrade';
