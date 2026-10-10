<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import Logo from '$lib/components/svforge/ui/Logo.svelte';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';

	interface Props {
		title: string;
		description: string;
		children: Snippet;
		footnote?: Snippet;
	}

	let { title, description, children, footnote }: Props = $props();
</script>

<main class="grid min-h-dvh bg-surface-50-950 text-surface-950-50 lg:grid-cols-5">
	<aside class="hidden border-r border-surface-200-800 bg-surface-100-900 p-12 lg:col-span-2 lg:flex lg:flex-col lg:justify-between xl:p-16">
		<Logo brandName={m.common_workspace()} />
		<p class="max-w-sm text-3xl font-semibold leading-tight text-surface-950-50 xl:text-4xl">
			{m.common_workspace_statement()}
		</p>
	</aside>

	<section class="flex min-h-dvh flex-col lg:col-span-3">
		<header class="flex items-center justify-between px-6 pt-6 sm:px-10 lg:justify-end lg:px-12">
			<div class="lg:hidden">
				<Logo brandName={m.common_workspace()} />
			</div>
			<ThemeToggle />
		</header>

		<div class="flex flex-1 items-start justify-center px-6 py-8 sm:px-10 lg:items-center lg:px-16 lg:py-10">
			<div class="w-full max-w-md">
				<div class="mb-8 space-y-3">
					<h1 class="h1">{title}</h1>
					<p class="text-surface-700-300">{description}</p>
				</div>
				{@render children()}
				{#if footnote}
					<div class="mt-6 text-sm text-surface-700-300">
						{@render footnote()}
					</div>
				{/if}
			</div>
		</div>
	</section>
</main>
