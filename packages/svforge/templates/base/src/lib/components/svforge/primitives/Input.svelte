<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		label?: string;
		error?: string;
		class?: string;
	}

	let {
		label,
		error,
		class: className,
		id,
		value = $bindable(''),
		'aria-describedby': describedBy,
		...rest
	}: Props = $props();

	// SSR-stable ids: $props.id() is deterministic across server render and
	// client hydration. Math.random() here produced different ids on the
	// server and client, breaking hydration and label association (#321).
	const uid = $props.id();
	const inputId = $derived(id ?? uid);
	const errorId = $derived(`${inputId}-error`);
	const hasError = $derived(error !== undefined && error !== '');
	// The error element is joined to (not replacing) a consumer-provided
	// aria-describedby.
	const describedByIds = $derived(
		hasError ? [describedBy, errorId].filter(Boolean).join(' ') : describedBy
	);
</script>

<div class="w-full">
	{#if label}
		<label class="label" for={inputId}>
			{label}
		</label>
	{/if}
	<input
		{...rest}
		id={inputId}
		class={cn('input border border-surface-600-400 focus:ring-primary-700-300! focus-visible:ring-2 focus-visible:ring-primary-700-300', className)}
		aria-invalid={hasError || undefined}
		aria-describedby={describedByIds}
		bind:value
	/>
	{#if hasError}
		<p id={errorId} class="text-error-700-300 mt-1 text-sm">{error}</p>
	{/if}
</div>
