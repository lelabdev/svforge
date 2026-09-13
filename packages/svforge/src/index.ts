import { defineAddon, defineAddonOptions } from 'sv';
import { baseFiles, dashboardFiles, dashboardRootFiles, baseRootFiles } from './templates';
import { applyBaseMode } from './modes/base';
import { applyDashboardMode } from './modes/dashboard';

// Export doctor diagnostics for programmatic use
export { doctor, printReport } from './doctor';
export type { DiagnosticResult, DoctorReport } from './doctor';
export {
	checkDesignSystem,
	SVFORGE_CATALOG,
	SKELETON_PRIMITIVES,
	FORBIDDEN_UI_KITS,
	DESIGN_RULE_IDS,
	DESIGN_MESSAGES,
	isForbiddenUiKit,
	duplicatedSkeletonPrimitiveName
} from './design-system';
export type { CatalogEntry, Severity, DesignSystemCheckOptions } from './design-system';
export {
	checkStructuralDuplicates,
	fingerprintSvelte,
	STRUCTURAL_DUPLICATION_THRESHOLD
} from './structural-duplication';
export type { StructuralDuplicate } from './structural-duplication';
export {
	MODULES,
	PRESETS,
	expandPreset,
	validateComposition
} from './module-composition';
export type { ModuleMeta, Preset } from './module-composition';
export {
	buildManifest,
	renderLlmstxt,
	mergeManifest,
	regenerateLlmstxt,
	MODULE_CAPABILITIES,
	DEPLOYMENT_PROFILES,
	MODULE_PROFILE_SUPPORT
} from './ai-context';
/**
 * Deprecated compatibility alias (#324): kept exported through the package
 * entry so existing imports of the old name keep working. Delegates to the
 * non-destructive planning core (planManifestEnrichContent in
 * @svforge/addon-kit) and warns once — an invalid manifest throws the
 * diagnosable JsonGuardError instead of being reset to an empty base.
 *
 * @deprecated Use `planManifestEnrich(rootDir, enrichment)` from
 *   @svforge/addon-kit (plan-then-write, non-destructive).
 */
export { enrichManifest } from './ai-context';
export type { SvforgeManifest, DeploymentProfile, ModuleProfileSupport } from './ai-context';

// Export upgrade command for programmatic use (#327): one diffable protocol
// for base, dashboard and the 13 standalone modules.
export {
	upgrade,
	printUpgradeResult,
	hasPlaywright,
	MODULE_RECIPES,
	BASE_RECIPE,
	DASHBOARD_RECIPE,
	changelogPackageOf,
	planUpgrade,
	applyPlan,
	sha256,
	resolveDestination,
	TRACKING_FILE
} from './upgrade';
export type {
	UpgradeFile,
	UpgradeResult,
	UpgradePlan,
	PlannedOperation,
	ApplyResult,
	UpgradeRecipe
} from './upgrade';
export { RELEASE_NOTES, entriesBetween } from './changelog';
export type { ChangelogEntry } from './changelog';
export { runAddCommand, parseAddArgs, detectPackageManager, dlxRunner, addonSpec } from './cli/add';
export type { ParsedAddArgs } from './cli/add';
export type { AddCommandOptions, AddCommandResult, AddResolvePolicy, PromptPort, SpawnPort } from './cli/add';
export { runCreateCommand, expandAllModules, parseCreateArgs } from './cli/create';
export type { CreateCommandOptions, CreateCommandResult, CreatePlan } from './cli/create';

export default defineAddon({
	id: 'svelteforge',
	alias: 'forge',
	shortDescription: 'SvelteForge — production-ready foundations for SvelteKit',
	homepage: 'https://github.com/lelabdev/svelteforge',

	options: defineAddonOptions()
		.add('template', {
			question: 'Which SvelteForge template?',
			type: 'select',
			default: 'base',
			options: [
				{ value: 'base', label: 'Base — UI kit + layouts + forms (landing, portfolio, marketing…)' },
				{ value: 'dashboard', label: 'Dashboard — base + admin dashboard + auth + DB' }
			]
		})
		.add('hooks', {
			// #416: the choice must be understandable without prior Git-hook
			// knowledge — the question states WHEN it runs, each label states
			// its practical consequence. Longer explanations live in the
			// generated next steps, not in this prompt.
			question: 'Run strict SVForge design checks before Git commits?',
			type: 'select',
			default: 'none',
			options: [
				{ value: 'none', label: 'None — no automatic commit check' },
				{ value: 'lefthook', label: 'Lefthook — block commits containing design-system errors or warnings' }
			]
		})
		.add('testing', {
			question: 'Which dashboard testing profile?',
			type: 'select',
			default: 'vitest',
			options: [
				{ value: 'vitest', label: 'Vitest — unit and server behavior tests' },
				{ value: 'playwright', label: 'Playwright — Vitest plus full browser tests' }
			]
		})
		.build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SvelteForge requires SvelteKit');
	},

	run: ({ sv, options, packageManager }) => {
		const template = options.template as 'base' | 'dashboard';
		const testing = options.testing as 'vitest' | 'playwright';
		const hooks = options.hooks as 'none' | 'lefthook';
		// The PM the user selected in `sv` (#325) — scaffolded scripts and the
		// setup docs must never invoke an unselected package manager.
		const pm = packageManager.split('@')[0];

		// ── Shared dependencies ──
		// Pinned major ranges (#197): `latest` would silently resolve the next
		// major (v4→v5 broke the theme, #194). Bumps are explicit PRs, tested in CI.
		sv.dependency('@fontsource-variable/fira-code', '^5.3.0');
		sv.dependency('@fontsource-variable/inter', '^5.3.0');
		sv.dependency('@fontsource-variable/space-grotesk', '^5.3.0');
		sv.dependency('clsx', '^2.1.1');
		sv.dependency('phosphor-svelte', '^3.1.0');
		sv.dependency('tailwind-merge', '^3.6.0');

		sv.devDependency('@eslint/compat', '^2.0.4');
		sv.devDependency('@eslint/js', '^10.0.1');
		sv.devDependency('@skeletonlabs/skeleton', '^5.0.0');
		sv.devDependency('@skeletonlabs/skeleton-svelte', '^5.0.0');
		sv.devDependency('eslint', '^10.0.0');
		sv.devDependency('eslint-config-prettier', '^10.0.0');
		sv.devDependency('eslint-plugin-svelte', '^3.0.0');
		sv.devDependency('globals', '^17.0.0');
		sv.devDependency('prettier', '^3.0.0');
		sv.devDependency('prettier-plugin-svelte', '^3.0.0');
		sv.devDependency('prettier-plugin-tailwindcss', '^0.7.0');
		sv.devDependency('typescript-eslint', '^8.0.0');
		sv.devDependency('@tailwindcss/forms', '^0.5.0');
		sv.devDependency('@tailwindcss/typography', '^0.5.0');
		sv.devDependency('@tailwindcss/vite', '^4.0.0');
		sv.devDependency('tailwindcss', '^4.0.0');

		// ── Vite config: ensure @tailwindcss/vite plugin ──
		sv.file('vite.config.ts', (content) => {
			if (content.includes('@tailwindcss/vite')) return content;
			let updated = content;
			updated = `import tailwindcss from '@tailwindcss/vite';\n${updated}`;
			updated = updated.replace(
				/plugins:\s*\[/,
				'plugins: [tailwindcss(), '
			);
			return updated;
		});

		// ── Apply mode-specific files ──
		if (template === 'dashboard') {
			// Dashboard inherits base: root files (Paraglide messages/),
			// vite.config plugin wiring, deps and test script come from the
			// base mode first, then dashboard-specific files overlay (#239).
			applyBaseMode(sv, {}, baseRootFiles, hooks, pm);
			applyDashboardMode(sv, baseFiles, dashboardFiles, testing, dashboardRootFiles, pm);
		} else {
			applyBaseMode(sv, baseFiles, baseRootFiles, hooks, pm);
		}
	},

	nextSteps: ({ options, packageManager }) => {
		// #325: the pm the user selected — scaffolded advice must never invoke
		// an unselected package manager (#416 extends this to the hook docs).
		const pm = (packageManager ?? 'npm').split('@')[0];
		const hooks = options.hooks as 'none' | 'lefthook';
		const lines = [
			`SvelteForge ${(options.template as string)} template applied!`,
			`Run \`${pm} run dev\` to start developing.`
		];
		if (hooks === 'lefthook') {
			// #416: state the practical consequence and the removal path.
			lines.push(
				'Lefthook runs `node svforge-check.mjs --strict` before commits that touch staged UI files — errors AND warnings block the commit.',
				'This is a development safeguard only: the app runs and builds without it. Remove anytime — remove the lefthook devDependency, delete .lefthook.yml, and drop the `prepare` script line.',
				`Run the same check manually: \`node svforge-check.mjs --strict\` (or \`${pm} run check\` for the full check).`
			);
		} else {
			// #416: a None user must know the check exists, is manual, and is
			// not required for the app to work.
			lines.push(
				'No automatic commit check installed (optional). You can still check manually anytime: `node svforge-check.mjs --strict` (or `' + pm + ' run check` for the full check).'
			);
		}
		return lines;
	}
});
