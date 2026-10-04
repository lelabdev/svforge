<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/svforge/primitives';

	let { data }: { data: import('./$types').PageData } = $props();
	const conversations = $derived(data.conversations);
</script>

<svelte:head><title>{m.chat_title()}</title></svelte:head>

<div class="max-w-7xl mx-auto px-4 py-8 space-y-8">
	<h1 class="text-3xl font-bold">{m.chat_title()}</h1>

	{#if conversations.length === 0}
		<p class="text-surface-500">{m.chat_empty()}</p>
	{:else}
		<ul class="divide-y divide-surface-200-800 rounded-container border border-surface-200-800 overflow-hidden">
			{#each conversations as conv (conv.id)}
				<li>
					<a href={`/chat/${conv.id}`} class="flex items-center justify-between px-4 py-3 hover:bg-surface-100-900 transition-colors">
						<div>
							<span class="font-semibold text-sm">{m.chat_conversation()} #{conv.id}</span>
							{#if conv.lastMessage}
								<span class="block text-xs text-surface-500 truncate max-w-md">
									{conv.lastMessage.authorId}: {conv.lastMessage.content}
								</span>
							{:else}
								<span class="block text-xs text-surface-500">{m.chat_no_messages()}</span>
							{/if}
						</div>
						<div class="flex items-center gap-3">
							{#if conv.lastMessage}
								<span class="text-xs text-surface-500">{new Date(conv.lastMessage.createdAt).toLocaleString()}</span>
							{/if}
							{#if conv.unreadCount > 0}
								<span class="min-w-5 h-5 px-1 bg-primary-500 text-white text-xs flex items-center justify-center">
									{conv.unreadCount}
								</span>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
