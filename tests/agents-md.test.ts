import { describe, it, expect } from 'vitest';
import type { SvApi } from 'sv';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import { scaffoldedAgents } from '../packages/svforge/src/scaffolded-agents';

/**
 * #347 — AGENTS.md is the SOLE agent convention of a SvelteForge project.
 *
 * Decision: one file to read, one file to edit. No tool-specific instruction
 * file (Claude, Gemini, Copilot, Cursor) is scaffolded, and there is no
 * synchronization or drift machinery. Instructions are advisory; mechanical
 * enforcement stays `svforge check`.
 */

describe('AGENTS.md as the sole agent convention (#347)', () => {
	it('is the only generated instruction file and carries the conventions', () => {
		const canonical = scaffoldedAgents('base');
		expect(canonical).toContain('# AGENTS.md');
		expect(canonical).toContain('svforge check');
		expect(canonical).toMatch(/advisory/i);
		expect(canonical).toContain('## Tailwind/Skeleton class lint (#482)');
		expect(canonical).toContain('Unknown or custom class names are errors by default');
		expect(canonical).toContain('targeted ESLint disable');
	});

	it('explicitly separates advisory instructions from enforced checks', () => {
		const canonical = scaffoldedAgents('base');
		expect(canonical).toMatch(/Advisory vs enforced/);
		expect(canonical).toMatch(/svforge check/);
	});

	it('gives every scaffold a reusable composition grammar', () => {
		const canonical = scaffoldedAgents('base');
		expect(canonical).toContain('## Composition grammar');
		expect(canonical).toContain('shell owns navigation and global context');
		expect(canonical).toContain('one dominant action');
		expect(canonical).toContain('A Card is a functional unit, not a default wrapper');
		expect(canonical).toContain('width follow the content');
	});

	it('propagates the Skeleton Dialog users-page golden reference into generated AGENTS.md', () => {
		const canonical = scaffoldedAgents('dashboard');
		expect(canonical).toContain('Golden references');
		expect(canonical).toContain('create/edit/invite/status flows using the official Skeleton `Dialog` with SvelteForge form primitives');
		expect(canonical).not.toContain('create/edit modal (`Card` + `Input`)');
	});

	it('carries the i18n contract: catalogs are the source of truth, generated code is off-limits (#322)', () => {
		const canonical = scaffoldedAgents('base');
		expect(canonical).toMatch(/## i18n \(Paraglide/);
		// Edit the JSON catalogs, NEVER the generated Paraglide output.
		expect(canonical).toMatch(/NEVER[\s\S]{0,80}generated/);
		expect(canonical).toMatch(/NEVER edit generated .src\/lib\/paraglide\//);
		// Locales are defaults, configured in the inlang settings file.
		expect(canonical).toMatch(/project\.inlang\/settings\.json/);
		expect(canonical).toMatch(/initial locales/i);
		// Parity is defined over EVERY configured locale, not a hard-coded pair.
		expect(canonical).toMatch(/every locale configured in .project\.inlang\/settings\.json./);
		expect(canonical).toMatch(/key parity/i);
		// Content boundary: static UI copy in catalogs, long-form content elsewhere.
		expect(canonical).toMatch(/does NOT belong in .messages\//);
		// How to extend: add a locale / change the base locale.
		expect(canonical).toMatch(/Adding a locale/);
	});

	it('names one source of truth per concern: theme, fonts, locales (#322)', () => {
		const canonical = scaffoldedAgents('base');
		expect(canonical).toMatch(/one source of truth per concern/);
		expect(canonical).toContain('src/lib/styles/svelteforge-theme.css');
		expect(canonical).toMatch(/@fontsource-variable\/\*. imports in .src\/routes\/layout\.css./);
		expect(canonical).toMatch(/messages\/\*\.json. \+ .project\.inlang\/settings\.json./);
	});

	it('scaffolds AGENTS.md and no other instruction file', () => {
		const sv = fakeSv();
		applyBaseMode(asSvApi(sv), { '/lib/base.ts': 'base' });
		expect(sv.files.has('AGENTS.md'), 'AGENTS.md must be scaffolded').toBe(true);
		for (const toolFile of ['CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/svforge.mdc']) {
			expect(sv.files.has(toolFile), `${toolFile} must NOT be scaffolded`).toBe(false);
		}
	});

	it('dashboard scaffold writes only AGENTS.md as instruction file', () => {
		const sv = fakeSv();
		applyBaseMode(asSvApi(sv), { '/lib/base.ts': 'base' });
		applyDashboardMode(asSvApi(sv), { '/lib/base.ts': 'base' }, {}, 'vitest');
		expect(sv.files.has('AGENTS.md')).toBe(true);
		expect(sv.files.has('.cursor/rules/svforge.mdc')).toBe(false);
	});
});

type FakeSv = {
	dependencies: string[];
	devDependencies: string[];
	files: Map<string, string>;
	dependency: (name: string, version: string) => void;
	devDependency: (name: string, version: string) => void;
	file: (path: string, transform: (content: string) => string) => void;
};

function fakeSv(): FakeSv {
	const sv: FakeSv = {
		dependencies: [],
		devDependencies: [],
		files: new Map(),
		dependency(name) {
			this.dependencies.push(name);
		},
		devDependency(name) {
			this.devDependencies.push(name);
		},
		file(path, transform) {
			this.files.set(path, transform(path === 'package.json' ? '{"scripts":{}}' : ''));
		}
	};
	return sv;
}

// FakeSv implements the SvApi surface the modes actually use; the unused
// required SvApi members are stubbed out at this single boundary.
const asSvApi = (sv: FakeSv): SvApi => sv as unknown as SvApi;
