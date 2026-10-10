import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, mergeEnvExample, mergeSvelteKitEnvVars, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';

const ENV_EXAMPLE = {
	GOOGLE_CLIENT_ID: { description: 'Google OAuth client ID', placeholder: 'your_google_client_id' },
	GOOGLE_CLIENT_SECRET: { description: 'Google OAuth client secret', placeholder: 'replace_with_google_client_secret' },
	GITHUB_CLIENT_ID: { description: 'GitHub OAuth client ID', placeholder: 'your_github_client_id' },
	GITHUB_CLIENT_SECRET: { description: 'GitHub OAuth client secret', placeholder: 'replace_with_github_client_secret' }
};
const ENV_DECLARATIONS = Object.fromEntries(
	Object.entries(ENV_EXAMPLE).map(([name, entry]) => [name, entry.description])
);



export default defineAddon({
	id: 'svforge-oauth',
	alias: 'forge-oauth',
	shortDescription: 'SVForge OAuth — social auth (Google, GitHub)',
	homepage: 'https://github.com/lelabdev/svforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge OAuth requires SvelteKit');
		// #323: the auth.currentUser requirement is enforced by the capability
		// gate in run() — structurally (Better Auth dependency), with a derived
		// error message. setup() of ALL addons runs before ANY run(), so a file
		// check here cannot see what a same-invocation template install writes.
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): the OAuth buttons call the authenticated
		// session client ($lib/client/auth) — Better Auth must be present.
		const gate = checkModuleCapabilities(cwd, 'oauth');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}
		// Capability warnings (#323): unverifiable or unverified requirements are
		// emitted as diagnostics — the install proceeds, support is never pretended.
		for (const warning of gate.warnings) console.warn(`[svforge] ${warning}`);


		// Better Auth social providers are built-in, no extra deps needed
		const context = planAddonContext(cwd, { moduleId: 'oauth', capability: 'oauth (Google/GitHub)', pattern: 'src/lib/components/svforge/ui/OAuthButtons.svelte' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}
		sv.file('src/env.ts', (content) => mergeSvelteKitEnvVars(content, ENV_DECLARATIONS));
		sv.file('.env.example', (content) => mergeEnvExample(content, 'oauth', ENV_EXAMPLE));

		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd }) => {
		const steps = [
			'@svforge/oauth installed!',
			'Add to your Better Auth config (src/lib/server/auth.ts):',
			'  socialProviders: {',
			'    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },',
			'    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }',
			'  }',
			'Add OAuth buttons: import OAuthButtons from "$lib/components/svforge/ui/OAuthButtons.svelte"',
			'Copy the OAuth placeholders from .env.example into .env and replace them (src/env.ts declarations were added automatically):',
			'  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET'
		];
		// Unverified capabilities (#323): on a non-SVForge project whose auth
		// wiring could not be confirmed structurally, install proceeds WITH a
		// clear warning instead of silently pretending support.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'oauth');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
