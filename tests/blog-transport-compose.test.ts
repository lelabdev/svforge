import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';

import { tempProject } from './helpers';
import { createBaseProject } from './helpers/fixtures';

const ROOT = process.cwd();
const ADDON_INDEX = join(ROOT, 'packages/blog/src/index.ts');

/**
 * Behavioral tests for #306 — the blog addon patches the consumer's
 * src/hooks.ts to carry MDsveX components across the SvelteKit data
 * boundary (#293). A consumer project may already export its own
 * `transport`; the patch must compose with it instead of emitting a
 * second `export const transport` (which would break compilation).
 *
 * We execute the REAL addon run against a mocked `sv` so the patch
 * logic (not just its source text) is exercised.
 */
const blogAddon = (await import(ADDON_INDEX)).default as any;

// Base-equivalent fixture dir shared by every runAddon call in this file.
const { dir: fixtureDir, cleanup: cleanupFixture } = tempProject('sf-blog-transport-');
createBaseProject(fixtureDir);
afterAll(() => cleanupFixture());

function runAddon(hooksTs?: string): {
	result: string | undefined;
	reapply: () => string | undefined;
} {
	const files = new Map<string, string>();
	let hooksTransform: ((c: string | undefined) => string) | undefined;
	const sv = {
		dependency: () => {},
		file: (path: string, transform: string | ((c: string | undefined) => string)) => {
			if (typeof transform === 'function') {
				if (path === 'src/hooks.ts') hooksTransform = transform;
				files.set(path, transform(files.get(path)));
			} else {
				files.set(path, transform);
			}
		}
	};
	if (hooksTs !== undefined) files.set('src/hooks.ts', hooksTs);
	// #323/#324: run() checks capabilities and plans JSON merges against the
	// REAL project (cwd) — a base-equivalent temp project provides them.
	blogAddon.run({ sv, cancel: () => {}, cwd: fixtureDir, options: {} });
	const result = files.get('src/hooks.ts');
	const reapply = () => (hooksTransform ? hooksTransform(result) : undefined);
	return { result, reapply };
}

const BASE_HOOKS = `import { reroute } from '$lib/paraglide/runtime.js';

export const reroute = (id: string) => reroute(id);
`;

const count = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length;

/** True when the file's braces are balanced (no broken object literal). */
function hasBalancedDecl(src: string): boolean {
	let depth = 0;
	let inString: string | null = null;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (inString) {
			if (ch === '\\') i++;
			else if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'") inString = ch;
		else if (ch === '{') depth++;
		else if (ch === '}') depth--;
	}
	return depth === 0;
}

describe('blog transport composition (#306)', () => {
	it('adds a fresh transport when none exists (standard scaffold)', () => {
		const { result } = runAddon(BASE_HOOKS);
		expect(result).toBeDefined();
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(result).toContain("'mdx-post'");
		expect(result).toContain('loadPostComponent');
		expect(result).toContain("export const reroute"); // Paraglide kept
		expect(result).toContain("import type { Transport } from '@sveltejs/kit/hooks';");
		expect(result).not.toContain("from '@sveltejs/kit';");
	});

	it('does not duplicate an existing Kit 3 Transport type import', () => {
		const hooks = `import type { Transport } from '@sveltejs/kit/hooks';\n` + BASE_HOOKS;
		const { result } = runAddon(hooks);
		expect(count(result!, /import type \{ Transport \} from/g)).toBe(1);
	});

	it('preserves an existing Kit 2 root Transport type import', () => {
		const hooks = `import type { Transport } from '@sveltejs/kit';\n` + BASE_HOOKS;
		const { result } = runAddon(hooks);
		expect(count(result!, /import type \{ Transport \} from/g)).toBe(1);
		expect(result).not.toContain("from '@sveltejs/kit/hooks';");
	});

	it('composes with an existing object-literal transport, keeping its codecs', () => {
		const withTransport = BASE_HOOKS + `export const transport: Transport = {
	custom: {
		encode: (v: unknown) => [v],
		decode: async ([v]: [unknown]) => v
	}
};
`;
		const { result } = runAddon(withTransport);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(result).toContain('custom:');
		expect(result).toContain("'mdx-post'");
		expect(count(result!, /'mdx-post':/g)).toBe(1);
		// existing codec body intact
		expect(result).toContain('encode: (v: unknown) => [v]');
	});

	it('composes with an object literal that already ends with a trailing comma', () => {
		const withTrailing = BASE_HOOKS + `export const transport = {
	other: { encode: () => [1], decode: async () => 1 },
};
`;
		const { result } = runAddon(withTrailing);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(count(result!, /'mdx-post':/g)).toBe(1);
		// no double comma after the existing property
		expect(result).not.toMatch(/,\s*,/);
	});

	it('fills an existing empty transport object literal', () => {
		const empty = BASE_HOOKS + `export const transport: Transport = {};
`;
		const { result } = runAddon(empty);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(count(result!, /'mdx-post':/g)).toBe(1);
		expect(result).not.toMatch(/,\s*,/);
	});

	it('wraps a non-literal transport expression (identifier reference)', () => {
		const reference = BASE_HOOKS + `export const transport = customTransport;
`;
		const { result } = runAddon(reference);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(result).toContain('const existingTransport = customTransport;');
		expect(result).toContain('...existingTransport');
		expect(count(result!, /'mdx-post':/g)).toBe(1);
	});

	it('handles codecs containing strings and template literals when scanning', () => {
		const tricky = BASE_HOOKS + `export const transport: Transport = {
	foo: {
		encode: (v) => [v, "a;b;c", \`x\${1 + 1}\`],
		decode: async ([v]) => v
	}
};
`;
		const { result } = runAddon(tricky);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(count(result!, /'mdx-post':/g)).toBe(1);
		expect(result).toContain('"a;b;c"');
		expect(hasBalancedDecl(result!)).toBe(true);
	});

	it('single-quoted strings inside codecs do not confuse the declaration scan', () => {
		// Regression: the inString closing branch must advance the cursor,
		// otherwise the closing quote is re-treated as an opening quote and
		// the rest of the file is swallowed (broken merged output).
		const single = BASE_HOOKS + `export const transport: Transport = {
	custom: {
		encode: (value: unknown) => (typeof value === 'string' ? [value] : null),
		decode: async ([value]: [string]) => value
	}
};
`;
		const { result } = runAddon(single);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(count(result!, /'mdx-post':/g)).toBe(1);
		expect(result).toContain("typeof value === 'string'");
		expect(hasBalancedDecl(result!)).toBe(true);
		// The mdx-post codec lives INSIDE the transport object (before its final '}')
		expect(result!.lastIndexOf("'mdx-post':") < result!.lastIndexOf('};')).toBe(true);
	});

	it('re-installation is idempotent: mdx-post and transport appear exactly once', () => {
		const { result, reapply } = runAddon(BASE_HOOKS);
		const second = reapply();
		expect(second).toBe(result);
	});

	it('re-installation is idempotent on a composed (existing transport) file', () => {
		const withTransport = BASE_HOOKS + `export const transport: Transport = {
	custom: { encode: () => [1], decode: async () => 1 }
};
`;
		const { result, reapply } = runAddon(withTransport);
		const second = reapply();
		expect(second).toBe(result);
		expect(count(result!, /export const transport/g)).toBe(1);
		expect(count(result!, /'mdx-post':/g)).toBe(1);
	});

	it('leaves an already-patched hooks.ts untouched (mdx-post present)', () => {
		const patched = BASE_HOOKS + `export const transport: Transport = {
	'mdx-post': { encode: () => null, decode: async () => null }
};
`;
		const { result } = runAddon(patched);
		expect(result).toBe(patched);
	});
});
