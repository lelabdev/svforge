<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Badge } from '$lib/components/svforge/primitives';
	import { Bell } from '$lib/icons';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';

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
		open = false;
		await fetch('/api/notifications/read-all', { method: 'POST' });
		window.location.reload();
	}
</script>

<Popover
	{open}
	onOpenChange={(details) => (open = details.open)}
	closeOnInteractOutside={true}
	restoreFocus={true}
>
	<Popover.Trigger class="btn preset-tonal-surface p-2 relative" aria-label={m.notif_bell()}>
		<Bell size={20} />
		{#if unreadCount > 0}
			<Badge class="absolute -top-1 -right-1">{unreadCount}</Badge>
		{/if}
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner>
			<Popover.Content class="w-80 max-h-96 overflow-auto rounded-container border border-surface-200-800 bg-surface-50-950 shadow-lg z-50">
				<div class="flex items-center justify-between px-4 py-3 border-b border-surface-200-800">
					<Popover.Title class="font-bold text-sm">{m.notif_title()}</Popover.Title>
					<button type="button" class="text-xs text-primary-900-100 hover:underline" onclick={markAll}>
						{m.notif_mark_all()}
					</button>
				</div>

				{#if items.length === 0}
					<p class="px-4 py-8 text-sm text-surface-700-300">{m.notif_empty()}</p>
				{:else}
					<ul class="divide-y divide-surface-200-800">
						{#each items as item (item.id)}
							<li class="px-4 py-3 {item.readAt ? '' : 'bg-surface-100-900/50'}">
								{#if item.actionUrl}
									<a href={item.actionUrl} class="block hover:text-primary-900-100">
										<span class="font-semibold text-sm">{item.title}</span>
										<span class="block text-xs text-surface-700-300 mt-0.5">{item.message}</span>
									</a>
								{:else}
									<span class="font-semibold text-sm">{item.title}</span>
									<span class="block text-xs text-surface-700-300 mt-0.5">{item.message}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
