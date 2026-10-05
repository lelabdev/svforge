<script lang="ts" generics="Row">
	import { dev } from '$app/env';
	import { cn } from '$lib/utils/cn';
	import type { TableProps } from '../primitives/types';

	let {
		columns,
		rows,
		rowKey,
		caption,
		class: className = '',
		children,
		empty,
		...rest
	}: TableProps<Row> = $props();

	// #321: rows are keyed by identity — a field name or key function — never
	// by array index, which corrupts keyed reconciliation on reorder/insert.
	function rowKeyOf(row: Row): string | number {
		if (typeof rowKey === 'function') return rowKey(row);
		if (rowKey !== undefined) return String((row as Record<string, unknown>)[rowKey]);
		// Primitive rows key on their own value. Object rows reaching this point
		// violate the contract (surfaced by the dev warning below) — there is no
		// index fallback here.
		return row as string | number;
	}

	// Dev-time contract check, REACTIVE (#321): `rows` can start empty and be
	// populated later (a fetch resolving, a filter clearing) — an init-only
	// check would miss that. Warns ONCE when an invalid object-row state first
	// appears, stays quiet while it persists, and re-arms if a corrected state
	// breaks again.
	let warnedMissingRowKey = $state(false);
	$effect(() => {
		if (!dev) return;
		const invalid =
			rowKey === undefined && rows.some((row) => typeof row === 'object' && row !== null);
		if (invalid && !warnedMissingRowKey) {
			warnedMissingRowKey = true;
			console.warn(
				'<Table>: `rows` contains objects but no `rowKey` was given. Pass a field name (rowKey="id") or a key function — falling back to index keys breaks keyed reconciliation (#321).'
			);
		} else if (!invalid) {
			warnedMissingRowKey = false;
		}
	});
</script>

<!--
	Structured table contract (#321): attributes (id, aria-*, data-*, handlers)
	describe the <table> element itself — the wrapper div is only Skeleton's
	`table-wrap` scroll container and carries no consumer API.
-->
<div class="table-wrap">
	<table class={cn('table', className)} {...rest}>
		{#if caption}
			<caption class="text-left">
				{#if typeof caption === 'function'}
					{@render caption()}
				{:else}
					{caption}
				{/if}
			</caption>
		{/if}
		<thead>
			<tr>
				{#each columns as col (col.key)}
					<th scope="col" class={col.class}>
						{col.label}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (rowKeyOf(row))}
				<tr class="hover:bg-surface-100-900">
					{#each columns as col (col.key)}
						<td class={col.class}>
							{#if children}
								{@render children({ row, col })}
							{:else}
								{String((row as Record<string, unknown>)[col.key] ?? '')}
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
			{#if rows.length === 0 && empty}
				<tr>
					<td colspan={columns.length}>
						{@render empty()}
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
</div>
