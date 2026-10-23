<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import * as m from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import {
		Users,
		Gear,
		ChartBar,
		SignOut,
		Menu,
		X,
		SquaresFour,
		CaretDoubleLeft,
		CaretDoubleRight
	} from '#lib/icons/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';
	import AvatarInitial from '#lib/components/svforge/ui/AvatarInitial.svelte';
	import ThemeToggle from '#lib/components/svforge/ui/ThemeToggle.svelte';
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

	/**
	 * One navigation item style for both surfaces (#636). The selected state is
	 * a Skeleton tonal preset (the preset owns bg+fg) plus a filled icon, so the
	 * active route reads as a state, not just a tinted row. `compact` is the
	 * collapsed sidebar: icon only, centred, with the label as accessible name.
	 */
	function navClass(href: string, compact = false) {
		return cn(
			'flex min-h-11 items-center gap-3 rounded-container px-3 text-sm transition-colors',
			'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700-300',
			compact && 'justify-center px-0',
			currentPath === href
				? 'preset-tonal-primary font-semibold'
				: 'text-surface-700-300 hover:preset-tonal-surface'
		);
	}

	function signOut() {
		mobileOpen = false;
		onSignOut?.();
	}
</script>

<Dialog
	open={mobileOpen}
	onOpenChange={(details) => (mobileOpen = details.open)}
	closeOnInteractOutside={true}
	restoreFocus={true}
>
	<div class={cn('flex min-h-dvh', className)}>
		<!-- Desktop sidebar: brand + navigation + theme utility -->
		<aside
			id="admin-sidebar"
			class={cn(
				'hidden shrink-0 flex-col border-r border-surface-200-800 bg-surface-100-900 transition-[width] duration-200 lg:flex',
				collapsed ? 'w-20' : 'w-64'
			)}
		>
			<div
				class={cn(
					'flex h-16 shrink-0 items-center border-b border-surface-200-800',
					collapsed ? 'justify-center px-2' : 'px-4'
				)}
			>
				<h1 class="min-w-0">
					<a
						href="/admin"
						class="flex items-center gap-3 rounded-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700-300"
					>
						<span
							class="grid size-9 shrink-0 place-items-center rounded-container preset-tonal-primary"
							aria-hidden="true"
						>
							<SquaresFour size={20} weight="fill" />
						</span>
						{#if !collapsed}
							<span class="truncate text-base font-bold tracking-tight">{m.layout_admin()}</span>
						{/if}
					</a>
				</h1>
			</div>

			<nav class="flex-1 space-y-1 overflow-y-auto px-2 py-4" aria-label={m.layout_menu()}>
				{#each items as item (item.href)}
					{@const Icon = item.icon}
					{@const active = currentPath === item.href}
					<a
						href={item.href}
						class={navClass(item.href, collapsed)}
						aria-current={active ? 'page' : undefined}
						aria-label={collapsed ? item.label : undefined}
						title={collapsed ? item.label : undefined}
					>
						<Icon size={20} weight={active ? 'fill' : 'regular'} class="shrink-0" />
						{#if !collapsed}<span class="truncate">{item.label}</span>{/if}
					</a>
				{/each}
			</nav>

			<div class="shrink-0 border-t border-surface-200-800 p-2">
				<div class={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
					<ThemeToggle />
				</div>
			</div>
		</aside>

		<!-- Main area -->
		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Top bar: sidebar/mobile control + identity + account utilities. The
			     app title lives in the sidebar brand (or here on mobile), and the
			     page title stays the page's own header — never a third copy. -->
			<header
				class="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-surface-200-800 bg-surface-50-950/80 px-4 backdrop-blur-md sm:px-6"
			>
				<div class="flex min-w-0 items-center gap-2 sm:gap-3">
					<Button
						type="button"
						variant="ghost"
						color="surface"
						class="hidden size-11 p-0 lg:inline-flex"
						onclick={() => (collapsed = !collapsed)}
						aria-label={m.layout_toggle_sidebar()}
						aria-expanded={!collapsed}
						aria-controls="admin-sidebar"
						data-testid="admin-sidebar-toggle"
					>
						{#if collapsed}
							<CaretDoubleRight size={18} />
						{:else}
							<CaretDoubleLeft size={18} />
						{/if}
					</Button>

					<Dialog.Trigger
						class="btn-icon size-11 preset-tonal-surface focus-visible:ring-2 focus-visible:ring-primary-700-300 cursor-pointer lg:hidden"
						aria-label={m.layout_menu()}
						data-testid="admin-mobile-menu-trigger"
					>
						<Menu size={20} />
					</Dialog.Trigger>
					<h1 class="truncate text-base font-semibold lg:hidden">{m.layout_admin()}</h1>
				</div>

				<div class="flex shrink-0 items-center gap-2 sm:gap-3">
					<ThemeToggle class="lg:hidden" />
					{#if user}
						<div class="flex min-w-0 items-center gap-2 sm:gap-3">
							<AvatarInitial name={user.name} size="sm" />
							<span class="hidden max-w-48 truncate text-sm font-medium sm:block">{user.name}</span>
						</div>
						{#if onSignOut}
							<span class="hidden h-6 w-px bg-surface-200-800 sm:block" aria-hidden="true"></span>
							<Button
								type="button"
								variant="ghost"
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
			<main class="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
				{@render children()}
			</main>
		</div>
	</div>

	<!-- Mobile drawer: same item style, labels always visible, account utilities
	     in the footer so signing out never requires hunting the top bar. -->
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 lg:hidden" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex justify-start lg:hidden">
			<Dialog.Content
				class="card preset-filled-surface-50-950 flex h-dvh w-72 max-w-[calc(100vw-1rem)] flex-col border-r border-surface-200-800 p-3 shadow-xl"
				data-testid="admin-mobile-drawer"
			>
				<header
					class="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-surface-200-800 pb-3"
				>
					<Dialog.Title class="flex min-w-0 items-center gap-3">
						<span
							class="grid size-9 shrink-0 place-items-center rounded-container preset-tonal-primary"
							aria-hidden="true"
						>
							<SquaresFour size={20} weight="fill" />
						</span>
						<span class="truncate text-base font-bold tracking-tight">{m.layout_admin()}</span>
					</Dialog.Title>
					<Dialog.CloseTrigger
						type="button"
						class="btn-icon size-11 hover:preset-tonal-surface focus-visible:ring-2 focus-visible:ring-primary-700-300 cursor-pointer"
						aria-label={m.layout_close_menu()}
					>
						<X size={20} />
					</Dialog.CloseTrigger>
				</header>

				<nav class="flex-1 space-y-1 overflow-y-auto" aria-label={m.layout_menu()}>
					{#each items as item (item.href)}
						{@const Icon = item.icon}
						{@const active = currentPath === item.href}
						<a
							href={item.href}
							class={navClass(item.href)}
							aria-current={active ? 'page' : undefined}
							onclick={() => (mobileOpen = false)}
						>
							<Icon size={20} weight={active ? 'fill' : 'regular'} class="shrink-0" />
							<span class="truncate">{item.label}</span>
						</a>
					{/each}
				</nav>

				<div class="mt-3 shrink-0 space-y-3 border-t border-surface-200-800 pt-3">
					{#if user}
						<div class="flex min-w-0 items-center gap-3 px-1">
							<AvatarInitial name={user.name} size="sm" />
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{user.name}</p>
								<p class="truncate text-xs text-surface-700-300">{user.email}</p>
							</div>
						</div>
					{/if}
					<div class="flex items-center justify-between gap-2">
						<ThemeToggle />
						{#if onSignOut}
							<Button type="button" variant="tonal" color="surface" onclick={signOut}>
								<SignOut size={18} class="mr-1" />
								{m.layout_sign_out()}
							</Button>
						{/if}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
