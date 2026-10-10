import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planCatalogMerges, planAddonContext, hasPatchApplied } from '@svforge/addon-kit';
import { files } from './templates';


export default defineAddon({
	id: 'svforge-audit',
	alias: 'forge-audit',
	shortDescription: 'SVForge Audit — business action audit trail (append-only)',
	homepage: 'https://github.com/lelabdev/svforge',
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Audit requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): audit needs the database, auth and i18n
		// contracts. Checked STRUCTURALLY on the real project (works in a
		// single `sv add svforge=template:dashboard audit` invocation and for
		// external implementations), FIRST so a refusal writes nothing.
		const gate = checkModuleCapabilities(cwd, 'audit');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}
		// Capability warnings (#323): unverifiable or unverified requirements are
		// emitted as diagnostics — the install proceeds, support is never pretended.
		for (const warning of gate.warnings) console.warn(`[svforge] ${warning}`);


		// JSON merges are PLANNED in memory before any write (#324): one
		// invalid catalog or manifest cancels the install and every file
		// stays byte-for-byte identical.
		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/fr.json',
				additions: {
					audit_title: 'Journal d’audit',
					audit_subtitle: 'Qui a fait quoi, sur quelle entité, quand.',
					audit_action: 'Action',
					audit_entity: 'Entité',
					audit_when: 'Quand',
					audit_actor: 'Acteur',
					audit_empty: 'Aucune entrée d’audit.',
					common_filter: 'Filtrer',
					common_previous: 'Précédent',
					common_next: 'Suivant'
				}
			},
			{
				path: 'messages/en.json',
				additions: {
					audit_title: 'Audit log',
					audit_subtitle: 'Who did what, on which entity, when.',
					audit_action: 'Action',
					audit_entity: 'Entity',
					audit_when: 'When',
					audit_actor: 'Actor',
					audit_empty: 'No audit entries.',
					common_filter: 'Filter',
					common_previous: 'Previous',
					common_next: 'Next'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		const context = planAddonContext(cwd, { moduleId: 'audit', capability: 'audit trail', pattern: 'src/lib/server/audit/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}

		// Every validation succeeded — writes may start.
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// Audit schema must be registered in the Drizzle schema barrel.
		sv.file('src/lib/server/db/schema.ts', (content) => {
			if (hasPatchApplied(content, 'audit-schema', ["from '$lib/server/audit/schema'"])) return content;
			return `import { auditLogs } from '$lib/server/audit/schema'; // svforge:patch:audit-schema\n${content}\nexport { auditLogs }; // svforge:patch:audit-schema\n`;
		});

		// Paraglide messages (#239): audit UI copy merged FR/EN — precomputed
		// above, applied here (existing keys are never overwritten).
		for (const write of catalogs.writes) {
			sv.file(write.path, () => write.content);
		}

		// AI context (#234): declare this module in .svforge.json (#324 plan).
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd }) => {
		const steps = [
			'@svforge/audit installed!',
			'Record: import { audit } from "$lib/server/audit";',
			'  await audit.record({ actorId: user.id, action: "punch.corrected", entityType: "punch", entityId: punch.id });',
			'Read: await audit.forEntity("punch", punchId); await audit.byActor(userId);',
			'Admin view: /admin/audit (pagination + filters)'
		];
		// Unverified capabilities (#323): on a non-SVForge project whose auth/db
		// wiring could not be confirmed structurally, install proceeds WITH a
		// clear warning instead of silently pretending support.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'audit');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
