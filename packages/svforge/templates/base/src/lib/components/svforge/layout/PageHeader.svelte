<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * Canonical page header (#601).
	 *
	 * The shell (AdminLayout, Navbar) owns the application title and navigation.
	 * A page states its own purpose through THIS component instead of
	 * re-assembling a `flex … justify-between` header per route: it owns the
	 * title typography, the optional description, the spacing and the
	 * responsive action row.
	 *
	 * Default-first styling is the contract: the `actions` snippet takes plain
	 * `Button` children, so equivalent page-header actions share one predictable
	 * size/typography/variant for both `href` and `onclick` branches. Pass an
	 * explicit size only for a genuinely different context (compact toolbar,
	 * icon-only control) — `svforge check` warns when a header action pins one.
	 */
	interface Props extends HTMLAttributes<HTMLElement> {
		/** Page title, rendered as the page-level heading under the shell's h1. */
		title: string;
		/** Optional one-line purpose/context shown under the title. */
		description?: string;
		/** Page actions (buttons/links). Keep the canonical Button defaults. */
		actions?: Snippet;
		class?: string;
	}

	let { title, description, actions, class: className = '', ...rest }: Props = $props();
</script>

<header
	{...rest}
	class={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}
>
	<div class="min-w-0 space-y-1">
		<h2 class="h2 break-words">{title}</h2>
		{#if description}
			<p class="text-surface-700-300">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex w-full flex-wrap gap-2 *:min-h-11 *:flex-1 sm:w-auto sm:*:flex-none">
			{@render actions()}
		</div>
	{/if}
</header>
