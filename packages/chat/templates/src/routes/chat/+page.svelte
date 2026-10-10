<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Card } from '$lib/components/svforge/ui';
	import { Badge } from '$lib/components/svforge/primitives';

	let { data }: { data: import('./$types').PageData } = $props();
	const conversations = $derived(data.conversations);
</script>

<svelte:head><title>{m.chat_title()}</title></svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:py-8">
	<h1 class="h1 break-words">{m.chat_title()}</h1>

	{#if conversations.length === 0}
		<Card variant="outlined" class="p-8 text-center text-surface-700-300">{m.chat_empty()}</Card>
	{:else}
		<Card variant="outlined" class="overflow-hidden p-0">
		<ul class="divide-y divide-surface-200-800">
			{#each conversations as conv (conv.id)}
				<li>
					<a href={`/chat/${conv.id}`} class="flex min-h-11 min-w-0 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-100-900">
						<div class="min-w-0">
							<span class="block truncate text-sm font-semibold">{m.chat_conversation()} #{conv.id}</span>
							{#if conv.lastMessage}
								<span class="block max-w-md truncate text-xs text-surface-700-300">
									{conv.lastMessage.authorId}: {conv.lastMessage.content}
								</span>
							{:else}
								<span class="block text-xs text-surface-700-300">{m.chat_no_messages()}</span>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-3">
							{#if conv.lastMessage}
								<span class="hidden max-w-32 truncate text-xs text-surface-700-300 sm:inline">{new Date(conv.lastMessage.createdAt).toLocaleString()}</span>
							{/if}
							{#if conv.unreadCount > 0}
								<Badge>{conv.unreadCount}</Badge>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
		</Card>
	{/if}
</div>
