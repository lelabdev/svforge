<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		label?: string;
		checked?: boolean;
		/** Custom classes go on the checkbox control, not the wrapping label (#321). */
		class?: string;
	}

	let { label, class: className, checked = $bindable(false), ...rest }: Props = $props();
</script>

<label class="flex cursor-pointer items-center gap-2">
	<input type="checkbox" {...rest} class={cn('checkbox border border-surface-600-400 focus-within:ring-primary-700-300! focus-visible:ring-2 focus-visible:ring-primary-700-300', className)} bind:checked />
	{#if label}
		<span>{label}</span>
	{/if}
</label>
