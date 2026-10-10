<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { SquaresFour } from '$lib/icons';

	interface Props {
		brandName?: string;
		class?: string;
	}

	let { brandName = '', class: className = '' }: Props = $props();
</script>

<span class={cn('inline-flex items-center gap-3 text-base font-semibold text-surface-950-50', className)}>
	<span class="flex h-9 w-9 items-center justify-center rounded-container preset-tonal-primary" aria-hidden="true">
		<SquaresFour size={20} weight="fill" />
	</span>
	{#if brandName}<span>{brandName}</span>{/if}
</span>
