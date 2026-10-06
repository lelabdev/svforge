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

export interface EnvExampleEntry {
	description: string;
	/** A documentation placeholder only — never a real credential. */
	placeholder?: string;
}

const ENV_EXAMPLE_BLOCK = /^# >>> svforge addon: ([a-z0-9_-]+) >>>\r?\n([\s\S]*?)^# <<< svforge addon: \1 <<<[ \t]*(?:\r?\n|$)/gm;
const ENV_VARIABLE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm;

/**
 * Merge one addon's documented environment placeholders into a project's
 * `.env.example`. Template-owned content is preserved; addon blocks are
 * replaced by owner and sorted by addon id so composition is deterministic
 * regardless of install order. Colliding variable names fail closed.
 */
export function mergeEnvExample(
	content: string | undefined,
	addonId: string,
	entries: Record<string, EnvExampleEntry>
): string {
	if (!/^[a-z][a-z0-9_-]*$/.test(addonId)) {
		throw new Error(`Invalid addon id for .env.example contribution: ${JSON.stringify(addonId)}`);
	}
	if (Object.keys(entries).length === 0) {
		throw new Error(`Addon ${addonId} must contribute at least one .env.example variable.`);
	}

	const blocks = new Map<string, string>();
	for (const match of (content ?? '').matchAll(ENV_EXAMPLE_BLOCK)) {
		const owner = match[1]!;
		if (blocks.has(owner)) {
			throw new Error(`Duplicate .env.example block for addon ${owner}.`);
		}
		blocks.set(owner, match[2]!.replace(/\r?\n$/, ''));
	}
	const baseContent = (content ?? '').replace(ENV_EXAMPLE_BLOCK, '');
	if (/^# (?:>>>|<<<) svforge addon:/m.test(baseContent)) {
		throw new Error('Malformed SVForge addon block in .env.example; refusing to overwrite it.');
	}

	// Reapplying an addon replaces its previous block before checking ownership.
	blocks.delete(addonId);
	const owners = new Map<string, string>();
	const collectOwners = (source: string, owner: string) => {
		for (const match of source.matchAll(ENV_VARIABLE)) {
			const name = match[1]!;
			const previousOwner = owners.get(name);
			if (previousOwner) {
				throw new Error(`Duplicate environment variable ${name} is defined by ${previousOwner} and ${owner}.`);
			}
			owners.set(name, owner);
		}
	};
	collectOwners(baseContent, 'the existing .env.example');
	for (const [owner, block] of blocks) collectOwners(block, `addon ${owner}`);

	const additions: string[] = [];
	for (const [name, entry] of Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
			throw new Error(`Invalid environment variable name ${JSON.stringify(name)} from addon ${addonId}.`);
		}
		if (!entry || typeof entry.description !== 'string' || !entry.description.trim() || /[\r\n]/.test(entry.description)) {
			throw new Error(`Invalid description for ${name} from addon ${addonId}.`);
		}
		const placeholder = entry.placeholder ?? '';
		if (typeof placeholder !== 'string' || /[\r\n]/.test(placeholder)) {
			throw new Error(`Invalid placeholder for ${name} from addon ${addonId}.`);
		}
		if (placeholder && !/^(?:your[_-]|replace_with_|https?:\/\/your[_-]|<[^>]+>$)/i.test(placeholder)) {
			throw new Error(`Environment example value for ${name} must use an obvious placeholder.`);
		}
		const previousOwner = owners.get(name);
		if (previousOwner) {
			throw new Error(`Environment variable ${name} is already defined by ${previousOwner}; refusing addon ${addonId}.`);
		}
		owners.set(name, `addon ${addonId}`);
		additions.push(`# ${entry.description}`, `${name}=${placeholder}`);
	}

	const body = additions.join('\n');
	blocks.set(addonId, body);
	const preserved = baseContent.replace(/(?:\r?\n)+$/, '');
	const renderedBlocks = [...blocks]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([owner, block]) => `# >>> svforge addon: ${owner} >>>\n${block}\n# <<< svforge addon: ${owner} <<<`)
		.join('\n\n');
	return `${[preserved, renderedBlocks].filter(Boolean).join('\n\n')}\n`;
}
