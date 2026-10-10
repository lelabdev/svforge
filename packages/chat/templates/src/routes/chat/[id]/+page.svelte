<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { enhance } from '$app/forms';
	import { Button, Textarea } from '$lib/components/svforge/primitives';
	import { Card } from '$lib/components/svforge/ui';

	let { data, form }: { data: import('./$types').PageData; form: any } = $props();
	const messages = $derived(data.messages);
	const conversationId = $derived(data.conversationId);
</script>

<svelte:head><title>{m.chat_conversation()} #{conversationId}</title></svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:py-8">
	<h1 class="h1 break-words">{m.chat_conversation()} #{conversationId}</h1>

	{#if messages.length === 0}
		<Card variant="outlined" class="p-8 text-center text-surface-700-300">{m.chat_empty()}</Card>
	{:else}
		<Card variant="outlined">
		<ul class="space-y-3">
			{#each [...messages].reverse() as msg (msg.id)}
				<li class="flex flex-col gap-0.5">
					<span class="text-xs text-surface-700-300">{msg.authorId} · {new Date(msg.createdAt).toLocaleString()}</span>
					<span class="break-words text-sm">{msg.content}</span>
				</li>
			{/each}
		</ul>
		</Card>
	{/if}

	{#if form?.error}
		<p class="text-error-700-300 text-sm">{form.error}</p>
	{/if}

	<form method="POST" action="?/send" use:enhance class="flex flex-col gap-3 sm:flex-row sm:items-end">
		<Textarea
			class="min-w-0 flex-1"
			label={m.chat_message()}
			name="content"
			rows={2}
			required
			placeholder={m.chat_placeholder()}
		/>
		<Button type="submit" class="min-h-11 self-end sm:self-auto">{m.chat_send()}</Button>
	</form>
</div>
