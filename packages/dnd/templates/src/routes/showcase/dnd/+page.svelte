<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import SortableList from '#lib/components/svforge/dnd/SortableList.svelte';
	import { Card } from '#lib/components/svforge/ui/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';

	/**
	 * Drag & drop showcase (#586, pilot).
	 *
	 * Local fixture only: the list is reordered in memory with the module's real
	 * `SortableList`, and the resulting order is printed below so the behaviour is
	 * observable without a backend, credentials or persistence.
	 */
	type DemoItem = { id: number; label: string };

	const initialItems = (): DemoItem[] => [
		{ id: 1, label: m.showcase_dnd_item_1() },
		{ id: 2, label: m.showcase_dnd_item_2() },
		{ id: 3, label: m.showcase_dnd_item_3() },
		{ id: 4, label: m.showcase_dnd_item_4() }
	];

	let items = $state<DemoItem[]>(initialItems());
	const order = $derived(items.map((item) => item.label).join(' → '));

	function reset() {
		items = initialItems();
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.showcase_dnd_title()}</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<header class="space-y-2">
		<h1 class="h1">{m.showcase_dnd_title()}</h1>
		<p class="text-surface-700-300">{m.showcase_dnd_description()}</p>
	</header>

	<Card>
		<p class="mb-4 text-sm text-surface-700-300">{m.showcase_dnd_hint()}</p>

		<SortableList bind:items>
			{#snippet children(item)}
				<span class="text-sm font-medium">{item.label}</span>
			{/snippet}
		</SortableList>

		<div class="mt-4 flex flex-col gap-3 border-t border-surface-200-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
			<p class="text-sm" aria-live="polite">
				<span class="font-semibold">{m.showcase_dnd_order()}:</span>
				{order}
			</p>
			<Button type="button" variant="tonal" color="surface" onclick={reset}>
				{m.showcase_dnd_reset()}
			</Button>
		</div>
	</Card>

	<p class="text-sm text-surface-700-300">{m.showcase_dnd_fixture()}</p>
</main>
