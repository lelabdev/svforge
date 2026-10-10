<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Table } from '$lib/components/svforge/ui';
	import { Button } from '$lib/components/svforge/primitives';
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

<div class="max-w-7xl mx-auto px-4 py-8 space-y-8">
	<h1 class="text-3xl font-bold">{m.audit_title()}</h1>
	<p class="text-surface-700-300">{m.audit_subtitle()}</p>

	<form method="get" class="flex flex-wrap items-end gap-4">
		<label class="flex flex-col gap-1 text-sm">
			{m.audit_action()}
			<input name="action" class="input" placeholder="punch.corrected" value={page.url.searchParams.get('action') ?? ''} />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.audit_entity()}
			<input name="entityType" class="input" placeholder="punch" value={page.url.searchParams.get('entityType') ?? ''} />
		</label>
		<Button type="submit">{m.common_filter()}</Button>
	</form>

	{#if rows.length}
		<Table {columns} {rows} rowKey="id" />

		<div class="flex gap-4">
			{#if offset > 0}
				<Button href={`/admin/audit?offset=${Math.max(0, offset - limit)}&limit=${limit}`} variant="outlined">
					{m.common_previous()}
				</Button>
			{/if}
			{#if rows.length === limit}
				<Button href={`/admin/audit?offset=${offset + limit}&limit=${limit}`}>
					{m.common_next()}
				</Button>
			{/if}
		</div>
	{:else}
		<p class="text-surface-700-300">{m.audit_empty()}</p>
	{/if}
</div>
