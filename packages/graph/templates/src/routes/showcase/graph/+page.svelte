<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import KnowledgeGraph from '#lib/components/svforge/graph/KnowledgeGraph.svelte';
	import { Card } from '#lib/components/svforge/ui/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';

	/**
	 * Graph showcase (#586, phase 4).
	 *
	 * The page drives the module's real `KnowledgeGraph` over a local fixture and
	 * mirrors node selection in an accessible panel, so the demo is usable with a
	 * pointer (canvas) or the keyboard (node buttons). No request, no storage.
	 */
	type DemoNode = { id: string; label: string; group: string };
	type DemoLink = { source: string; target: string };

	const nodes: DemoNode[] = [
		{ id: 'home', label: m.showcase_graph_node_home(), group: 'entry' },
		{ id: 'showcase', label: m.showcase_graph_node_showcase(), group: 'entry' },
		{ id: 'modules', label: m.showcase_graph_node_modules(), group: 'concept' },
		{ id: 'auth', label: m.showcase_graph_node_auth(), group: 'concept' },
		{ id: 'db', label: m.showcase_graph_node_db(), group: 'concept' }
	];

	const links: DemoLink[] = [
		{ source: 'home', target: 'showcase' },
		{ source: 'showcase', target: 'modules' },
		{ source: 'modules', target: 'auth' },
		{ source: 'modules', target: 'db' },
		{ source: 'auth', target: 'db' }
	];

	let selected = $state<DemoNode | null>(null);
	const connections = $derived(
		selected
			? links.filter((link) => link.source === selected!.id || link.target === selected!.id).length
			: 0
	);

	function select(node: { id: string }) {
		selected = nodes.find((candidate) => candidate.id === node.id) ?? null;
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.showcase_graph_title()}</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<header class="space-y-2">
		<h1 class="h1">{m.showcase_graph_title()}</h1>
		<p class="text-surface-700-300">{m.showcase_graph_description()}</p>
	</header>

	<Card>
		<p class="mb-3 text-sm text-surface-700-300">{m.showcase_graph_hint()}</p>
		<KnowledgeGraph
			{nodes}
			{links}
			height="320px"
			showLabels
			nodeLabel="label"
			onNodeClick={(node) => select(node)}
		/>
	</Card>

	<section class="space-y-3" aria-live="polite">
		<h2 class="h2">{m.showcase_graph_selection()}</h2>
		{#if selected}
			<p class="text-sm">
				<span class="font-semibold">{selected.label}</span>
				—
				{m.showcase_graph_connections({ count: connections })}
			</p>
		{:else}
			<p class="text-sm text-surface-700-300">{m.showcase_graph_no_selection()}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-2" role="group" aria-label={m.showcase_graph_nodes()}>
			{#each nodes as node (node.id)}
				<Button
					type="button"
					size="sm"
					variant={selected?.id === node.id ? 'filled' : 'tonal'}
					color={selected?.id === node.id ? 'primary' : 'surface'}
					aria-pressed={selected?.id === node.id}
					onclick={() => select(node)}
				>
					{node.label}
				</Button>
			{/each}
			<Button type="button" variant="ghost" color="surface" disabled={!selected} onclick={() => (selected = null)}>
				{m.showcase_graph_clear()}
			</Button>
		</div>
	</section>

	<p class="text-sm text-surface-700-300">{m.showcase_graph_fixture()}</p>
</main>
