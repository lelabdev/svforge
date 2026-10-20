<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { cn } from '#lib/utils/cn.js';
	import { X } from '#lib/icons/index.js';
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';

	/**
	 * Shared application-modal shell (#603).
	 *
	 * Owns the one Skeleton `Dialog` composition every admin form/confirmation
	 * modal needs: portal, backdrop, positioner, panel surface, accessible title
	 * and close control, focus trap/restoration, Escape dismissal and the
	 * "an open form is not discarded by an outside click" policy.
	 *
	 * It deliberately does NOT own page state: the consumer passes the controlled
	 * `open` signal, receives `onOpenChange`, and renders its own SvelteKit
	 * forms, permissions and localized copy as the `children` snippet. Interaction
	 * stays in Skeleton, composition here, business logic in the route.
	 *
	 * `animate-dialog` is NOT applied: that Skeleton utility animates a native
	 * `<dialog open>` element, while `Dialog.Content` is a `div[data-state]`, so
	 * the utility would leave the panel transparent behind a dimmed backdrop.
	 */
	interface Props {
		/** Controlled open state owned by the consumer. */
		open: boolean;
		/** Called with the requested state (Escape, close control, outside policy). */
		onOpenChange: (open: boolean) => void;
		/** Accessible dialog title rendered in the header. */
		title: string;
		/** Optional supporting copy rendered as the dialog description. */
		description?: string;
		/** Panel width preset; pick the smallest size that fits the content. */
		size?: 'sm' | 'md' | 'lg';
		/** Skeleton interaction policy; forms keep the default `false`. */
		closeOnInteractOutside?: boolean;
		/** Accessible label of the close control; defaults to the shared copy. */
		closeLabel?: string;
		class?: string;
		children: Snippet;
	}

	let {
		open,
		onOpenChange,
		title,
		description,
		size = 'md',
		closeOnInteractOutside = false,
		closeLabel = m.common_close(),
		class: className,
		children
	}: Props = $props();

	const sizes = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-2xl'
	} as const;
</script>

<Dialog
	{open}
	{closeOnInteractOutside}
	restoreFocus={true}
	onOpenChange={(details) => onOpenChange(details.open)}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class={cn(
					'card preset-filled-surface-50-950 w-full p-4 shadow-xl',
					sizes[size],
					className
				)}
			>
				<header class="mb-4 flex items-center justify-between">
					<Dialog.Title class="h3">{title}</Dialog.Title>
					<Dialog.CloseTrigger
						class="btn-icon size-11 preset-tonal-surface focus-visible:ring-2 focus-visible:ring-primary-700-300 cursor-pointer"
						aria-label={closeLabel}
						data-testid="app-dialog-close"
					>
						<X size={18} />
					</Dialog.CloseTrigger>
				</header>

				{#if description}
					<Dialog.Description class="mb-4 text-sm text-surface-700-300">
						{description}
					</Dialog.Description>
				{/if}

				{@render children()}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
