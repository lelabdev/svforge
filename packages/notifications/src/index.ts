import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planCatalogMerges, planAddonContext, hasPatchApplied } from '@svforge/addon-kit';
import { files } from './templates';


export default defineAddon({
	id: 'svforge-notifications',
	alias: 'forge-notifications',
	shortDescription: 'SVForge Notifications — persistent business notifications (read/unread)',
	homepage: 'https://github.com/lelabdev/svelteforge',
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Notifications requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): notifications need the database contract and
		// Paraglide catalogs for the bell UI copy.
		const gate = checkModuleCapabilities(cwd, 'notifications');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}
		// Capability warnings (#323): unverifiable or unverified requirements are
		// emitted as diagnostics — the install proceeds, support is never pretended.
		for (const warning of gate.warnings) console.warn(`[svforge] ${warning}`);


		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/fr.json',
				additions: {
					notif_title: 'Notifications',
					notif_bell: 'Notifications',
					notif_mark_all: 'Tout marquer comme lu',
					notif_empty: 'Aucune notification.'
				}
			},
			{
				path: 'messages/en.json',
				additions: {
					notif_title: 'Notifications',
					notif_bell: 'Notifications',
					notif_mark_all: 'Mark all as read',
					notif_empty: 'No notifications.'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		const context = planAddonContext(cwd, { moduleId: 'notifications', capability: 'notifications', pattern: 'src/lib/server/notifications/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// Extend the public icon barrel without replacing base or user exports.
		const notificationsIconExport = "export * from './notifications';";
		sv.file('src/lib/icons/index.ts', (content) => {
			if (content.split(/\r?\n/).some((line) => line.trim() === notificationsIconExport)) return content;
			const newline = content.includes('\r\n') ? '\r\n' : '\n';
			const separator = content.length > 0 && !content.endsWith('\n') ? newline : '';
			return `${content}${separator}${notificationsIconExport}${newline}`;
		});

		// Register the schema in the Drizzle barrel (#331: named marker, not a
		// loose includes() that a consumer comment could false-match).
		sv.file('src/lib/server/db/schema.ts', (content) => {
			if (hasPatchApplied(content, 'notifications-schema', ["from '$lib/server/notifications/schema'"])) return content;
			return `import { notifications } from '$lib/server/notifications/schema'; // svforge:patch:notifications-schema\n${content}\nexport { notifications }; // svforge:patch:notifications-schema\n`;
		});

		// Paraglide messages (#239) + manifest (#234): PLANNED in memory before
		// any write (#324) — one invalid catalog or manifest cancels the whole
		// install and every file stays byte-for-byte identical.

		for (const write of [...catalogs.writes, ...context.writes]) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd }) => {
		const steps = [
			'@svforge/notifications installed!',
			'Create: import { notificationsApi } from "$lib/server/notifications";',
			'  await notificationsApi.create({ userId, type: "export.ready", title, message, actionUrl });',
			'UI: add <NotificationsBell /> to your navbar (load items in +layout.server.ts)',
			'Optional realtime: publish { channel: `user:${userId}`, event: "notification.created" } after create'
		];
		// Unverified capabilities (#323): on a non-SVForge project whose DB
		// wiring could not be confirmed structurally, install proceeds WITH a
		// clear warning instead of silently pretending support.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'notifications');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
