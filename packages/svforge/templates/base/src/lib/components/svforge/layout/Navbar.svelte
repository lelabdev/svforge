<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';
	import Logo from '$lib/components/svforge/ui/Logo.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { Menu, X } from '$lib/icons';

	interface Props extends HTMLAttributes<HTMLElement> {
		brand?: Snippet;
		links?: { href: string; label: string }[];
		class?: string;
	}

	let { brand, links = [], class: className, ...rest }: Props = $props();
	let mobileOpen = $state(false);
</script>

<nav class={cn('sticky top-0 z-50 border-b border-surface-200-800 bg-surface-50-950/80 text-surface-950-50 backdrop-blur-md', className)} {...rest}>
	<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
		<!-- Brand -->
		<a href="/" class="text-xl font-bold">
			{#if brand}
				{@render brand()}
			{:else}
				<Logo brandName={m.common_workspace()} />
			{/if}
		</a>

		<!-- Desktop links -->
		<div class="hidden items-center gap-4 md:flex">
			{#each links as link (link.href)}
				<a href={link.href} class="anchor">
					{link.label}
				</a>
			{/each}
			<ThemeToggle />
		</div>

		<!-- Mobile toggle -->
		<button
			class="btn p-2 hover:preset-tonal-surface md:hidden"
			onclick={() => (mobileOpen = !mobileOpen)}
			aria-label={m.nav_toggle_menu()}
		>
			{#if mobileOpen}
				<X size={20} />
			{:else}
				<Menu size={20} />
			{/if}
		</button>
	</div>

	<!-- Mobile menu -->
	{#if mobileOpen}
		<div class="flex flex-col gap-3 border-t border-surface-200-800 px-4 py-3 md:hidden">
			{#each links as link (link.href)}
				<a href={link.href} class="anchor" onclick={() => (mobileOpen = false)}>
					{link.label}
				</a>
			{/each}
			<ThemeToggle />
		</div>
	{/if}
</nav>
