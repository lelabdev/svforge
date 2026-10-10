<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends HTMLTextareaAttributes {
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
	// client hydration (see Input.svelte, #321).
	const uid = $props.id();
	const textareaId = $derived(id ?? uid);
	const errorId = $derived(`${textareaId}-error`);
	const hasError = $derived(error !== undefined && error !== '');
	const describedByIds = $derived(
		hasError ? [describedBy, errorId].filter(Boolean).join(' ') : describedBy
	);
</script>

<div class="w-full">
	{#if label}
		<label class="label" for={textareaId}>
			{label}
		</label>
	{/if}
	<textarea
		{...rest}
		id={textareaId}
		class={cn('textarea border border-surface-600-400 focus:ring-primary-700-300! focus-visible:ring-2 focus-visible:ring-primary-700-300', className)}
		aria-invalid={hasError || undefined}
		aria-describedby={describedByIds}
		bind:value
	></textarea>
	{#if hasError}
		<p id={errorId} class="text-error-700-300 mt-1 text-sm">{error}</p>
	{/if}
</div>
