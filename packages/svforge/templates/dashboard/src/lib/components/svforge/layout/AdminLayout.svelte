<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import * as m from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Users, Gear, ChartBar, SignOut, Menu, X } from '$lib/icons';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';

	type NavItem = { href: string; label: string; icon: typeof ChartBar };

	interface Props extends HTMLAttributes<HTMLElement> {
		items?: NavItem[];
		currentPath?: string;
		user?: { name: string; email: string } | null;
		onSignOut?: () => void;
		class?: string;
		children: Snippet;
	}

	let {
		items = [
			{ href: '/admin', label: m.layout_dashboard(), icon: ChartBar },
			{ href: '/admin/users', label: m.layout_users(), icon: Users },
			{ href: '/admin/settings', label: m.layout_settings(), icon: Gear }
		],
		currentPath = '',
		user = null,
		onSignOut,
		class: className,
		children
	}: Props = $props();

	let collapsed = $state(false);
	let mobileOpen = $state(false);

	function navClass(href: string) {
		return cn(
			'flex items-center gap-3 rounded-container px-3 py-2 transition-colors',
			currentPath === href
				? 'bg-primary-100-900 text-primary-950-50'
				: 'text-surface-700-300 hover:bg-surface-100-900'
		);
	}
</script>

<div class={cn('flex min-h-screen', className)}>
	<!-- Desktop Sidebar -->
	<aside class="hidden flex-col border-r border-surface-200-800 bg-surface-50-950 transition-all lg:flex {collapsed ? 'w-16' : 'w-56'}">
		<div class="flex items-center justify-between border-b border-surface-200-800 p-3">
			{#if !collapsed}
				<a href="/admin" class="text-lg font-bold text-primary-900-100">{m.layout_admin()}</a>
			{/if}
			<button
				class="btn p-1 preset-tonal-surface"
				onclick={() => (collapsed = !collapsed)}
				aria-label={m.layout_toggle_sidebar()}
				aria-expanded={!collapsed}
			>
				<Menu size={18} />
			</button>
		</div>

		<nav class="flex-1 space-y-1 p-2" aria-label={m.layout_menu()}>
			{#each items as item (item.href)}
				{@const Icon = item.icon}
				<a
					href={item.href}
					class={navClass(item.href)}
					aria-current={currentPath === item.href ? 'page' : undefined}
				>
					<Icon size={20} />
					{#if !collapsed}<span class="text-sm font-medium">{item.label}</span>{/if}
				</a>
			{/each}
		</nav>

		<div class="border-t border-surface-200-800 p-2">
			<ThemeToggle />
		</div>
	</aside>

	<!-- Main area -->
	<div class="flex flex-1 flex-col">
		<!-- Top bar -->
		<header class="sticky top-0 z-50 flex items-center justify-between border-b border-surface-200-800 bg-surface-50-950/80 px-4 py-3 backdrop-blur-md">
			<div class="flex items-center gap-3">
				<button class="btn p-2 preset-tonal-surface lg:hidden" onclick={() => (mobileOpen = !mobileOpen)} aria-label={m.layout_menu()} aria-expanded={mobileOpen}>
					{#if mobileOpen}<X size={20} />{:else}<Menu size={20} />{/if}
				</button>
				<h1 class="text-lg font-bold">{m.layout_admin()}</h1>
			</div>
			<div class="flex items-center gap-3">
				<ThemeToggle class="lg:hidden" />
				{#if user}
					<span class="hidden text-sm text-surface-700-300 sm:block">{user.name}</span>
					{#if onSignOut}
						<button class="btn p-2 preset-tonal-surface" onclick={onSignOut} aria-label={m.layout_sign_out()}>
							<SignOut size={18} />
						</button>
					{/if}
				{/if}
			</div>
		</header>

		<!-- Mobile sidebar overlay -->
		{#if mobileOpen}
			<button
				type="button"
				aria-label={m.layout_close_menu()}
				class="fixed inset-0 z-40 w-full cursor-default bg-black/50 lg:hidden"
				onclick={() => (mobileOpen = false)}
			></button>
			<aside class="fixed left-0 top-0 z-50 h-full w-56 space-y-1 border-r border-surface-200-800 bg-surface-50-950 p-3 shadow-xl lg:hidden" aria-label={m.layout_menu()}>
				{#each items as item (item.href)}
					{@const Icon = item.icon}
					<a
						href={item.href}
						class={navClass(item.href)}
						aria-current={currentPath === item.href ? 'page' : undefined}
						onclick={() => (mobileOpen = false)}
					>
						<Icon size={20} />
						<span class="text-sm font-medium">{item.label}</span>
					</a>
				{/each}
			</aside>
		{/if}

		<!-- Content -->
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
