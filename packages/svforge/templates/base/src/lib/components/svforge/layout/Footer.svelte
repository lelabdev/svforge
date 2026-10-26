<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { localizeHref } from '#lib/paraglide/runtime.js';

	interface Props extends HTMLAttributes<HTMLElement> {
		links?: { href: string; label: string }[];
		class?: string;
		children?: Snippet;
	}

	let { links = [], class: className, children, ...rest }: Props = $props();

	// Same contract as the Navbar: internal paths are localized here (#588).
	const hrefFor = (href: string) => (href.startsWith("/") ? localizeHref(href) : href);
</script>

<footer class={cn('border-t border-surface-200-800 bg-surface-100-900', className)} {...rest}>
	<div class="mx-auto max-w-7xl px-4 py-8">
		<div class="flex flex-col justify-between gap-6 md:flex-row">
			{#if children}
				{@render children()}
			{/if}

			{#if links.length}
				<div class="flex flex-col gap-2">
					{#each links as link (link.href)}
						<a href={hrefFor(link.href)} class="anchor text-sm">
							{link.label}
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mt-8 border-t border-surface-200-800 pt-3 text-sm text-surface-700-300">
			&copy; {new Date().getFullYear()} SVForge. All rights reserved.
		</div>
	</div>
</footer>
