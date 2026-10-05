/**
 * Add named optional variables to a SvelteKit 3 `src/env.ts` declaration.
 * Addons use this when an integration provides environment-backed settings;
 * existing declarations are preserved and repeated installs are idempotent.
 */
export function mergeSvelteKitEnvVars(content: string | undefined, declarations: Record<string, string>): string {
	const missing = Object.entries(declarations).filter(([name]) => {
		if (!content) return true;
		return !new RegExp(`^\\s*${name}\\s*:`, 'm').test(content);
	});
	if (missing.length === 0) return content ?? '';

	const additions = missing.map(([name, description]) =>
		`\t${name}: { description: ${JSON.stringify(description)}, schema: (value) => value }`
	);
	if (!content?.trim()) {
		return [
			"import { defineEnvVars } from '@sveltejs/kit/env';",
			'',
			'export const variables = defineEnvVars({',
			...additions,
			'});',
			''
		].join('\n');
	}

	const start = content.indexOf('defineEnvVars({');
	const callEnd = content.lastIndexOf('});');
	if (start === -1 || callEnd === -1 || callEnd < start) {
		throw new Error('Cannot merge SvelteKit environment variables: src/env.ts must export defineEnvVars({...})');
	}
	const objectEnd = content.lastIndexOf('}', callEnd);
	if (objectEnd <= start) throw new Error('Cannot locate the defineEnvVars object in src/env.ts');
	const before = content.slice(0, objectEnd).trimEnd();
	const separator = before.endsWith(',') ? '\n' : ',\n';
	return `${before}${separator}${additions.join(',\n')}\n${content.slice(objectEnd)}`;
}
