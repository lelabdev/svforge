<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import * as m from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Users, Gear, ChartBar, SignOut, Menu, X } from '$lib/icons';
	import { Button } from '$lib/components/svforge/primitives';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';

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
			'flex min-h-11 items-center gap-3 rounded-container px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700-300',
			currentPath === href
				? 'bg-primary-100-900 text-primary-950-50'
				: 'text-surface-700-300 hover:bg-surface-100-900'
		);
	}
</script>

<Dialog
	open={mobileOpen}
	onOpenChange={(details) => (mobileOpen = details.open)}
	closeOnInteractOutside={true}
	restoreFocus={true}
>
<div class={cn('flex min-h-screen', className)}>
	<!-- Desktop Sidebar -->
	<aside class="hidden flex-col border-r border-surface-200-800 bg-surface-50-950 transition-all lg:flex {collapsed ? 'w-16' : 'w-56'}">
		<div class="flex items-center justify-between border-b border-surface-200-800 p-3">
			{#if !collapsed}
				<a href="/admin" class="text-lg font-bold text-primary-900-100">{m.layout_admin()}</a>
			{/if}
			<Button
				type="button"
				variant="tonal"
				color="surface"
				class="size-11 p-0"
				onclick={() => (collapsed = !collapsed)}
				aria-label={m.layout_toggle_sidebar()}
				aria-expanded={!collapsed}
			>
				<Menu size={18} />
			</Button>
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
				<Dialog.Trigger
					class="btn-icon size-11 preset-tonal-surface focus-visible:ring-2 focus-visible:ring-primary-700-300 lg:hidden"
					aria-label={m.layout_menu()}
					data-testid="admin-mobile-menu-trigger"
				>
					<Menu size={20} />
				</Dialog.Trigger>
				<h1 class="text-lg font-bold">{m.layout_admin()}</h1>
			</div>
			<div class="flex items-center gap-3">
				<ThemeToggle class="lg:hidden" />
				{#if user}
					<span class="hidden text-sm text-surface-700-300 sm:block">{user.name}</span>
					{#if onSignOut}
						<Button
							type="button"
							variant="tonal"
							color="surface"
							class="size-11 p-0"
							onclick={onSignOut}
							aria-label={m.layout_sign_out()}
						>
							<SignOut size={18} />
						</Button>
					{/if}
				{/if}
			</div>
		</header>


		<!-- Content -->
		<main class="flex-1 overflow-auto p-4 sm:p-6">
			{@render children()}
		</main>
	</div>
</div>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 lg:hidden" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex justify-start lg:hidden">
			<Dialog.Content
				class="card preset-filled-surface-50-950 flex h-dvh w-72 max-w-[calc(100vw-1rem)] flex-col border-r border-surface-200-800 p-3 shadow-xl"
				data-testid="admin-mobile-drawer"
			>
				<header class="mb-3 flex items-center justify-between border-b border-surface-200-800 pb-3">
					<Dialog.Title class="h3">{m.layout_admin()}</Dialog.Title>
					<Dialog.CloseTrigger
						type="button"
						class="btn-icon size-11 hover:preset-tonal-surface focus-visible:ring-2 focus-visible:ring-primary-700-300"
						aria-label={m.layout_close_menu()}
					>
						<X size={20} />
					</Dialog.CloseTrigger>
				</header>
				<nav class="flex-1 space-y-1" aria-label={m.layout_menu()}>
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
				</nav>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
