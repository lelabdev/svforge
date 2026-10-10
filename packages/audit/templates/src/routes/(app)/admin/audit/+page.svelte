<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Card, Table } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { page } from '$app/state';

	let { data }: { data: import('./$types').PageData } = $props();
	const entries = $derived(data.entries);
	const offset = $derived(data.offset);
	const limit = $derived(data.limit);

	const rows = $derived(
		entries.map((e) => ({
			id: e.id,
			when: new Date(e.createdAt).toLocaleString(),
			actor: e.actorId ?? 'system',
			action: e.action,
			entity: `${e.entityType}${e.entityId ? `:${e.entityId}` : ''}`
		}))
	);
	const columns = [
		{ key: 'when', label: m.audit_when() },
		{ key: 'actor', label: m.audit_actor() },
		{ key: 'action', label: m.audit_action() },
		{ key: 'entity', label: m.audit_entity() }
	];
</script>

<svelte:head><title>{m.audit_title()}</title></svelte:head>

<div class="space-y-6">
	<header class="space-y-2">
		<h2 class="h2">{m.audit_title()}</h2>
		<p class="text-surface-700-300">{m.audit_subtitle()}</p>
	</header>

	<form method="get" class="flex flex-wrap items-end gap-4">
		<Input
			class="min-w-48 flex-1"
			label={m.audit_action()}
			name="action"
			placeholder="punch.corrected"
			value={page.url.searchParams.get('action') ?? ''}
		/>
		<Input
			class="min-w-48 flex-1"
			label={m.audit_entity()}
			name="entityType"
			placeholder="punch"
			value={page.url.searchParams.get('entityType') ?? ''}
		/>
		<Button type="submit" class="min-h-11">{m.common_filter()}</Button>
	</form>

	{#if rows.length}
		<Table {columns} {rows} rowKey="id" />

		<div class="flex flex-wrap gap-2">
			{#if offset > 0}
				<Button class="min-h-11" href={`/admin/audit?offset=${Math.max(0, offset - limit)}&limit=${limit}`} variant="outlined">
					{m.common_previous()}
				</Button>
			{/if}
			{#if rows.length === limit}
				<Button class="min-h-11" href={`/admin/audit?offset=${offset + limit}&limit=${limit}`}>
					{m.common_next()}
				</Button>
			{/if}
		</div>
	{:else}
		<Card variant="outlined" class="p-8 text-center text-surface-700-300">{m.audit_empty()}</Card>
	{/if}
</div>
