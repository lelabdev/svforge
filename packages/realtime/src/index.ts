import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';


export default defineAddon({
	id: 'svforge-realtime',
	alias: 'forge-realtime',
	shortDescription: 'SVForge Realtime — generic WebSocket transport (publish/subscribe)',
	homepage: 'https://github.com/lelabdev/svforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Realtime requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): realtime needs a WebSocket-capable runtime.
		// This cannot be verified from files — the gate succeeds but returns a
		// warning that surfaces in nextSteps.
		const gate = checkModuleCapabilities(cwd, 'realtime');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		sv.dependency('ws', '^8.21.3');
		sv.devDependency('@types/ws', '^8.5.14');

		const context = planAddonContext(cwd, { moduleId: 'realtime', capability: 'realtime (WebSocket)', pattern: 'src/lib/server/realtime/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd }) => {
		const steps = [
			'@svforge/realtime installed!',
			'Wire the hub: in src/hooks.server.ts, attach the WS server on startup',
			'  or run `realtime.listen(PORT)` (see README)',
			'Publish: import { realtime } from "$lib/server/realtime";',
			'  await realtime.publish({ channel: "org:1", event: "punch.created", payload: { punchId } });',
			'Client: const rt = createRealtimeClient("/api/realtime");',
			'  rt.subscribe("org:1", "punch.created", (p) => invalidate("app:punches"));'
		];
		// runtime.websocket is unverifiable from files (#323): surface the
		// deployment constraint as a warning, never as a hard failure.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'realtime');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
