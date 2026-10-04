<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import Bell from 'phosphor-svelte/lib/Bell';
	import Check from 'phosphor-svelte/lib/Check';

	interface NotificationItem {
		id: string;
		type: string;
		title: string;
		message: string;
		actionUrl: string | null;
		readAt: string | null;
		createdAt: string;
	}

	let { items, unreadCount }: { items: NotificationItem[]; unreadCount: number } = $props();
	let open = $state(false);

	async function markAll() {
		await fetch('/api/notifications/read-all', { method: 'POST' });
		open = false;
		window.location.reload();
	}
</script>

<div class="relative">
	<button
		type="button"
		class="btn preset-tonal-surface p-2 relative"
		onclick={() => (open = !open)}
		aria-label={m.notif_bell()}
	>
		<Bell size={20} />
		{#if unreadCount > 0}
			<span class="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-primary-500 text-white text-xs flex items-center justify-center">
				{unreadCount}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded-container border border-surface-200-800 bg-surface-50-950 shadow-lg z-50">
			<div class="flex items-center justify-between px-4 py-3 border-b border-surface-200-800">
				<span class="font-bold text-sm">{m.notif_title()}</span>
				<button type="button" class="text-xs text-primary-500 hover:underline" onclick={markAll}>
					{m.notif_mark_all()}
				</button>
			</div>

			{#if items.length === 0}
				<p class="px-4 py-8 text-sm text-surface-500">{m.notif_empty()}</p>
			{:else}
				<ul class="divide-y divide-surface-200-800">
					{#each items as item (item.id)}
						<li class="px-4 py-3 {item.readAt ? '' : 'bg-surface-100-900/50'}">
							{#if item.actionUrl}
								<a href={item.actionUrl} class="block hover:text-primary-500">
									<span class="font-semibold text-sm">{item.title}</span>
									<span class="block text-xs text-surface-500 mt-0.5">{item.message}</span>
								</a>
							{:else}
								<span class="font-semibold text-sm">{item.title}</span>
								<span class="block text-xs text-surface-500 mt-0.5">{item.message}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
