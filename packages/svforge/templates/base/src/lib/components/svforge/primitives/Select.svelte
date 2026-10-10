<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Option {
		value: string;
		label: string;
	}

	interface Props extends HTMLSelectAttributes {
		label?: string;
		error?: string;
		options: Option[];
		class?: string;
	}

	let {
		label,
		error,
		options,
		class: className,
		id,
		value = $bindable(''),
		'aria-describedby': describedBy,
		...rest
	}: Props = $props();

	// SSR-stable ids: $props.id() is deterministic across server render and
	// client hydration (see Input.svelte, #321). The select ALWAYS carries a
	// real id, so the label `for` targets it even when the consumer passes none.
	const uid = $props.id();
	const selectId = $derived(id ?? uid);
	const errorId = $derived(`${selectId}-error`);
	const hasError = $derived(error !== undefined && error !== '');
	const describedByIds = $derived(
		hasError ? [describedBy, errorId].filter(Boolean).join(' ') : describedBy
	);
</script>

<div class="w-full">
	{#if label}
		<label class="label" for={selectId}>
			{label}
		</label>
	{/if}
	<select
		{...rest}
		id={selectId}
		class={cn('select border border-surface-600-400 focus:ring-primary-700-300! focus-visible:ring-2 focus-visible:ring-primary-700-300', className)}
		aria-invalid={hasError || undefined}
		aria-describedby={describedByIds}
		bind:value
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
	{#if hasError}
		<p id={errorId} class="text-error-700-300 mt-1 text-sm">{error}</p>
	{/if}
</div>
