/**
 * Official-integration preflight (#547 phase C).
 *
 * SVForge no longer ships the generic Paraglide / Drizzle / Better Auth
 * foundation: it EXTENDS the output of the official `sv add` add-ons. A direct
 * `sv add svforge=template:<base|dashboard>` therefore only works after those
 * add-ons ran in the same project.
 *
 * The published `sv` (1.1.1) cannot express conditional add-on dependencies
 * with options (`setup()` does not receive the add-on options — upstream
 * sveltejs/cli#1419 is still open), so SVForge detects the missing official
 * output BEFORE writing anything and cancels with the exact supported manual
 * sequence. `svforge create` remains the one-command path: it runs the
 * official add-ons first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARAGLIDE_ADD_SPEC } from './i18n';

export type ScaffoldTemplate = 'base' | 'dashboard';

/** Files the official `sv add paraglide` integration generates. */
export const PARAGLIDE_FILES = [
	'project.inlang/settings.json',
	'src/hooks.server.ts',
	'src/hooks.ts'
] as const;

/** Additional files the official Drizzle + Better Auth integrations generate. */
export const AUTH_DB_FILES = ['src/lib/server/auth.ts', 'src/lib/server/db/index.ts', 'src/env.ts'] as const;

/** Non-interactive official add-on specs (same values as `svforge create`). */
export const DRIZZLE_ADD_SPEC = 'drizzle=database:postgresql+client:postgres.js+docker:no';
export const BETTER_AUTH_ADD_SPEC = 'better-auth=demo:';

type Inspection = {
	exists: (path: string) => boolean;
	read: (path: string) => string;
};

const defaultInspection: Inspection = {
	exists: (path) => existsSync(path),
	read: (path) => readFileSync(path, 'utf8')
};

/**
 * Official artifacts missing from `cwd`. The hooks file must also carry the
 * Paraglide middleware (and, for the dashboard, the Better Auth handler):
 * a hand-written hook without them would silently ship a broken project.
 */
export function missingOfficialIntegrations(
	cwd: string,
	template: ScaffoldTemplate,
	inspection: Inspection = defaultInspection
): string[] {
	const missing: string[] = [];
	for (const file of PARAGLIDE_FILES) {
		if (!inspection.exists(join(cwd, file))) missing.push(file);
	}
	if (template === 'dashboard') {
		for (const file of AUTH_DB_FILES) {
			if (!inspection.exists(join(cwd, file))) missing.push(file);
		}
	}
	const hooksPath = join(cwd, 'src/hooks.server.ts');
	if (inspection.exists(hooksPath)) {
		const hooks = inspection.read(hooksPath);
		if (!hooks.includes('paraglideMiddleware')) missing.push('src/hooks.server.ts (paraglide handle)');
		if (template === 'dashboard' && !hooks.includes('svelteKitHandler')) {
			missing.push('src/hooks.server.ts (better-auth handler)');
		}
	}
	return missing;
}

/** `npx --yes` / `bunx` / `pnpm dlx` runner for the selected package manager. */
function runner(packageManager: string): string {
	switch (packageManager.split('@')[0]) {
		case 'bun':
			return 'bunx';
		case 'pnpm':
			return 'pnpm dlx';
		default:
			return 'npx --yes';
	}
}

/**
 * Actionable cancellation text: the exact official commands, the supported
 * one-command alternative, and an explicit "nothing was written" guarantee.
 */
export function officialIntegrationsRequiredMessage(
	template: ScaffoldTemplate,
	packageManager = 'npm'
): string {
	const dlx = runner(packageManager);
	const commands = [`${dlx} sv add "${PARAGLIDE_ADD_SPEC}"`];
	if (template === 'dashboard') {
		commands.push(`${dlx} sv add "${DRIZZLE_ADD_SPEC}"`, `${dlx} sv add "${BETTER_AUTH_ADD_SPEC}"`);
	}
	return [
		`SVForge ${template} extends the OFFICIAL Svelte integrations and requires them to run first.`,
		'A direct `sv add svforge=…` cannot install them automatically with the published `sv` CLI.',
		'',
		'Run these commands in the project, then re-run the SVForge add:',
		...commands.map((command, index) => `  ${index + 1}. ${command}`),
		'',
		`Supported one-command alternative (runs the official add-ons first):`,
		`  npx svforge create <dir> --template ${template} --pm ${packageManager.split('@')[0]}`,
		'',
		'Nothing was written to this project.'
	].join('\n');
}
