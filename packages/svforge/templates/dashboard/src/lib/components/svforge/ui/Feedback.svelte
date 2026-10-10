<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import * as m from '$lib/paraglide/messages.js';
	import { Check, Warning, X } from '$lib/icons';
	import { Button } from '$lib/components/svforge/primitives';

	interface Props {
		type: 'success' | 'error';
		message: string;
		ondismiss?: () => void;
		class?: string;
	}

	let { type, message, ondismiss, class: className }: Props = $props();
</script>

{#if message}
	<!-- #317: the Skeleton tonal presets own the semantic bg+fg pairing —
	     never hand-pair bg-*-100-900 with text-*-700-300 (that re-implements
	     preset-tonal-*). rounded-container + p-3 stay: plain <div> layout via
	     Tailwind and the theme radius token. -->
	<div role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} class={cn('flex items-center gap-2 rounded-container p-3', type === 'success' ? 'preset-tonal-success' : 'preset-tonal-error', className)}>
		{#if type === 'success'}<Check size={18} />{:else}<Warning size={18} />{/if}
		<span class="text-sm">{message}</span>
		{#if ondismiss}
			<Button
				type="button"
				variant="ghost"
				color="surface"
				class="ml-auto size-11 shrink-0 p-0"
				onclick={ondismiss}
				aria-label={m.common_dismiss()}
			><X size={18} /></Button>
		{/if}
	</div>
{/if}
