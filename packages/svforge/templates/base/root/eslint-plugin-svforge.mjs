/**
 * ESLint adapter for the scaffolded SvelteForge design-system engine (#346).
 *
 * Thin on purpose: every check, message, and rule id comes from
 * svforge-check.mjs — the same engine `bun run check` and the Vite build
 * gate run. This file only maps engine helpers onto ESLint rule mechanics;
 * never duplicate analysis logic here.
 */
import path from 'node:path';
import {
	DESIGN_MESSAGES,
	DESIGN_RULE_IDS,
	duplicatedSkeletonPrimitiveName
} from './svforge-check.mjs';

const rule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'report deterministic SvelteForge design-system violations'
		},
		messages: {
			[DESIGN_RULE_IDS.duplicatedSkeletonPrimitive]: DESIGN_MESSAGES.duplicatedSkeletonPrimitive('{{name}}', '{{file}}')
		},
		schema: []
	},
	create(context) {
		return {
			Program(node) {
				const filename = context.filename;
				if (!filename.endsWith('.svelte')) return;
				const primitive = duplicatedSkeletonPrimitiveName(filename, context.cwd);
				if (!primitive) return;
				context.report({
					node,
					messageId: DESIGN_RULE_IDS.duplicatedSkeletonPrimitive,
					data: { name: primitive, file: path.relative(context.cwd, filename) }
				});
			}
		};
	}
};

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
	meta: { name: 'eslint-plugin-svforge' },
	rules: { 'no-design-violations': rule }
};

export default plugin;
