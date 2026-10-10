import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planCatalogMerges, planAddonContext, hasPatchApplied } from '@svforge/addon-kit';
import { files } from './templates';


export default defineAddon({
	id: 'svforge-chat',
	alias: 'forge-chat',
	shortDescription: 'SVForge Chat — composable app chat (conversations, messages, read-state)',
	homepage: 'https://github.com/lelabdev/svforge',
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Chat requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): chat needs the database, identity (locals.user),
		// Paraglide catalogs and the SVForge UI kit (Button primitive).
		const gate = checkModuleCapabilities(cwd, 'chat');
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
					chat_title: 'Messages',
					chat_conversation: 'Conversation',
					chat_empty: 'Aucun message pour le moment.',
					chat_no_messages: 'Aucun message',
					chat_message: 'Message',
					chat_placeholder: 'Écrivez votre message…',
					chat_send: 'Envoyer'
				}
			},
			{
				path: 'messages/en.json',
				additions: {
					chat_title: 'Messages',
					chat_conversation: 'Conversation',
					chat_empty: 'No messages yet.',
					chat_no_messages: 'No messages',
					chat_message: 'Message',
					chat_placeholder: 'Write your message…',
					chat_send: 'Send'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		const context = planAddonContext(cwd, { moduleId: 'chat', capability: 'chat', pattern: 'src/lib/server/chat/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// Register the chat schemas in the Drizzle barrel.
		sv.file('src/lib/server/db/schema.ts', (content) => {
			if (hasPatchApplied(content, 'chat-schema', ["from '$lib/server/chat/schema'"])) return content;
			return `import { conversations, conversationParticipants, messages as chatMessages, messageReads } from '$lib/server/chat/schema'; // svforge:patch:chat-schema\n${content}\nexport { conversations, conversationParticipants, chatMessages, messageReads }; // svforge:patch:chat-schema\n`;
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
			'@svforge/chat installed!',
			'Routes: /chat (list) and /chat/[id] (conversation)',
			'API: import { chat } from "$lib/server/chat";',
			'  await chat.createConversation({ participantIds: [userA, userB] });',
			'  await chat.sendMessage({ conversationId, authorId: user.id, content: "Bonjour" });',
			'Optional: realtime → publish message.created on conversation:{id}',
			'  uploads → attachments, notifications → alert non-active participants'
		];
		// Unverified capabilities (#323): on a non-SVForge project whose auth/db
		// wiring could not be confirmed structurally, install proceeds WITH a
		// clear warning instead of silently pretending support.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'chat');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
