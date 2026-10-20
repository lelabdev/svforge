<script lang="ts">
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from './toaster.ts';
</script>

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast {toast}>
			<Toast.Message>
				<Toast.Title>{toast.title}</Toast.Title>
				{#if toast.description}
					<Toast.Description>{toast.description}</Toast.Description>
				{/if}
			</Toast.Message>
			<Toast.CloseTrigger class="cursor-pointer" />
		</Toast>
	{/snippet}
</Toast.Group>
