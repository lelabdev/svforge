<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import Toaster from '#lib/components/svforge/ui/Toaster.svelte';
	import { toaster } from '#lib/components/svforge/ui/toaster.js';
	import { Card } from '#lib/components/svforge/ui/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';

	/**
	 * Toast showcase (#586, phase 2).
	 *
	 * The page mounts its own `Toaster` group and fires the module's real
	 * `toaster` store, so the interaction works before the root layout is wired.
	 * Everything stays in this page: no request, no persistence.
	 */
	type Variant = 'success' | 'error' | 'info' | 'warning';

	const variants: { type: Variant; label: () => string; color: 'success' | 'error' | 'primary' | 'warning' }[] = [
		{ type: 'success', label: m.showcase_toast_success, color: 'success' },
		{ type: 'error', label: m.showcase_toast_error, color: 'error' },
		{ type: 'info', label: m.showcase_toast_info, color: 'primary' },
		{ type: 'warning', label: m.showcase_toast_warning, color: 'warning' }
	];

	function fire(type: Variant, label: string) {
		toaster.create({ type, title: label, description: m.showcase_toast_body() });
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.showcase_toast_title()}</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<header class="space-y-2">
		<h1 class="h1">{m.showcase_toast_title()}</h1>
		<p class="text-surface-700-300">{m.showcase_toast_description()}</p>
	</header>

	<Card>
		<p class="mb-4 text-sm text-surface-700-300">{m.showcase_toast_hint()}</p>
		<div class="flex flex-wrap gap-2">
			{#each variants as variant (variant.type)}
				<Button type="button" variant="tonal" color={variant.color} onclick={() => fire(variant.type, variant.label())}>
					{variant.label()}
				</Button>
			{/each}
		</div>
	</Card>

	<p class="text-sm text-surface-700-300">
		{m.showcase_toast_mount_note()}
		<code class="text-primary-900-100">&lt;Toaster /&gt;</code>
		<code class="text-primary-900-100">src/routes/+layout.svelte</code>
	</p>

	<Toaster />
</main>
