import { defineAddon, defineAddonOptions } from 'sv';
import { mergeSvelteKitEnvVars, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-email',
	alias: 'forge-email',
	shortDescription: 'SVForge Email — transactional emails via Resend',
	homepage: 'https://github.com/lelabdev/svelteforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),
	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Email requires SvelteKit');
	},
	run: ({ sv, cancel, cwd }) => {
		sv.dependency('resend', '^6.20.0');
		const context = planAddonContext(cwd, { moduleId: 'email', capability: 'email (Resend)', pattern: 'src/lib/server/email.ts' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}
		sv.file('src/env.ts', (content) =>
			mergeSvelteKitEnvVars(content, { RESEND_API_KEY: 'Resend API key' })
		);
		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},
	nextSteps: () => [
		'@svforge/email installed!',
		'Add RESEND_API_KEY to your .env',
		'Usage: import { sendEmail } from "$lib/server/email"',
		'  await sendEmail({ to: "user@example.com", subject: "Welcome", html: "<h1>Welcome!</h1>" });'
	]
});
