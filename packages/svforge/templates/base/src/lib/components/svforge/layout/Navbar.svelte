<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Button } from '#lib/components/svforge/primitives/index.js';
	import ThemeToggle from '#lib/components/svforge/ui/ThemeToggle.svelte';
	import LocaleSwitcher from '#lib/components/svforge/ui/LocaleSwitcher.svelte';
	import Logo from '#lib/components/svforge/ui/Logo.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { localizeHref } from '#lib/paraglide/runtime.js';
	import { Menu, X } from '#lib/icons/index.js';

	interface Props extends HTMLAttributes<HTMLElement> {
		brand?: Snippet;
		links?: { href: string; label: string }[];
		class?: string;
	}

	let { brand, links = [], class: className, ...rest }: Props = $props();
	let mobileOpen = $state(false);

	// Consumers pass plain internal paths; the shell owns the locale prefix so a
	// page cannot forget it (#588). External URLs pass through untouched.
	const hrefFor = (href: string) => (href.startsWith("/") ? localizeHref(href) : href);
</script>

<nav class={cn('sticky top-0 z-50 border-b border-surface-200-800 bg-surface-50-950/80 text-surface-950-50 backdrop-blur-md', className)} {...rest}>
	<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
		<!-- Brand -->
		<a href={localizeHref('/')} class="text-xl font-bold">
			{#if brand}
				{@render brand()}
			{:else}
				<Logo brandName={m.common_workspace()} />
			{/if}
		</a>

		<!-- Desktop links -->
		<div class="hidden items-center gap-4 md:flex">
			{#each links as link (link.href)}
				<a href={hrefFor(link.href)} class="anchor">
					{link.label}
				</a>
			{/each}
			<LocaleSwitcher />
			<ThemeToggle />
		</div>

		<!-- Mobile toggle -->
		<Button
			type="button"
			variant="ghost"
			color="surface"
			class="size-11 p-0 md:hidden"
			onclick={() => (mobileOpen = !mobileOpen)}
			aria-label={m.nav_toggle_menu()}
			aria-expanded={mobileOpen}
		>
			{#if mobileOpen}
				<X size={20} />
			{:else}
				<Menu size={20} />
			{/if}
		</Button>
	</div>

	<!-- Mobile menu -->
	{#if mobileOpen}
		<div class="flex flex-col gap-3 border-t border-surface-200-800 px-4 py-3 md:hidden">
			{#each links as link (link.href)}
				<a href={hrefFor(link.href)} class="anchor flex min-h-11 items-center" onclick={() => (mobileOpen = false)}>
					{link.label}
				</a>
			{/each}
			<LocaleSwitcher />
			<ThemeToggle />
		</div>
	{/if}
</nav>
