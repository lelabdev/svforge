import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext, hasPatchApplied } from '@svforge/addon-kit';
import { files } from './templates';


export default defineAddon({
	id: 'svforge-jobs',
	alias: 'forge-jobs',
	shortDescription: 'SVForge Jobs — background job foundation (retry, progress, encapsulated backend)',
	homepage: 'https://github.com/lelabdev/svforge',
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Jobs requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): jobs needs the database contract, and a
		// long-lived worker runtime (unverifiable from files → warning).
		const gate = checkModuleCapabilities(cwd, 'jobs');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		const context = planAddonContext(cwd, { moduleId: 'jobs', capability: 'background jobs', pattern: 'src/lib/server/jobs/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// Register the schema in the Drizzle barrel.
		sv.file('src/lib/server/db/schema.ts', (content) => {
			if (hasPatchApplied(content, 'jobs-schema', ["from '$lib/server/jobs/schema'"])) return content;
			return `import { jobs } from '$lib/server/jobs/schema'; // svforge:patch:jobs-schema\n${content}\nexport { jobs }; // svforge:patch:jobs-schema\n`;
		});

		// #328: the runner is NEVER auto-started in the web runtime (every web
		// process, serverless instance or hot reload would start a poller).
		// Installation instead wires the explicit worker entrypoint.
		sv.file('package.json', (content) => {
			if (!content) return content;
			const pkg = JSON.parse(content);
			pkg.scripts = { ...pkg.scripts, 'jobs:worker': 'bun src/lib/server/jobs/worker.ts' };
			return `${JSON.stringify(pkg, null, 2)}\n`;
		});

		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd }) => {
		const steps = [
			'@svforge/jobs installed!',
			'Define a handler: import { define } from "$lib/server/jobs";',
			'  define("payroll.export", async (payload, ctx) => { await ctx.progress(10); ... return { fileId }; });',
			'Enqueue: await jobs.enqueue("payroll.export", { organizationId });',
			'Worker: `bun run jobs:worker` — the web runtime never starts a poller (#328).',
			'Guarantees: at-least-once → handlers must be idempotent; claims are atomic + lease-guarded; retries back off; throw NonRetryableJobError to skip retries.'
		];
		// runtime.longLivedWorker is unverifiable from files (#323): surface the
		// deployment constraint as a warning, never as a hard failure.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'jobs');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
