<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		label?: string;
		checked?: boolean;
		/** Custom classes go on the checkbox control, not the wrapping label (#321). */
		class?: string;
	}

	let {
		label,
		class: className,
		checked = $bindable(false),
		disabled = false,
		...rest
	}: Props = $props();
</script>

<label
	class={cn(
		'flex items-center gap-2',
		// #594: an enabled control advertises its click affordance; a disabled
		// one must not look actionable.
		disabled ? 'cursor-not-allowed' : 'cursor-pointer'
	)}
>
	<input
		type="checkbox"
		{...rest}
		{disabled}
		class={cn(
			'checkbox border border-surface-600-400 focus-within:ring-primary-700-300! focus-visible:ring-2 focus-visible:ring-primary-700-300',
			className
		)}
		bind:checked
	/>
	{#if label}
		<span>{label}</span>
	{/if}
</label>
