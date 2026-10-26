<script lang="ts">
	import type { JSONContent } from '@tiptap/core';
	import * as m from '#lib/paraglide/messages.js';
	import { TiptapEditor, TiptapPreview } from '#lib/components/svforge/tiptap/index.js';
	import { Card } from '#lib/components/svforge/ui/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';

	/**
	 * Tiptap showcase (#586, phase 3).
	 *
	 * The page drives the module's real editor, toolbar and preview over a local
	 * document: typing updates the preview through the same `onUpdate` payload a
	 * consumer would persist. Nothing leaves the page.
	 */
	const sample = (): JSONContent => ({
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: m.showcase_tiptap_sample_heading() }]
			},
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: m.showcase_tiptap_sample_body() },
					{ type: 'text', marks: [{ type: 'bold' }], text: ` ${m.showcase_tiptap_sample_bold()}` },
					{ type: 'text', text: m.showcase_tiptap_sample_tail() }
				]
			},
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: m.showcase_tiptap_sample_item_1() }] }
						]
					},
					{
						type: 'listItem',
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: m.showcase_tiptap_sample_item_2() }] }
						]
					}
				]
			},
			{
				type: 'blockquote',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: m.showcase_tiptap_sample_quote() }] }]
			}
		]
	});

	let content = $state<JSONContent>(sample());
	// The editor owns its document once mounted; a keyed block re-initialises it
	// from the sample when the example is reset.
	let revision = $state(0);

	function reset() {
		content = sample();
		revision += 1;
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.showcase_tiptap_title()}</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-8 px-4 py-8">
	<header class="space-y-2">
		<h1 class="h1">{m.showcase_tiptap_title()}</h1>
		<p class="text-surface-700-300">{m.showcase_tiptap_description()}</p>
	</header>

	<section class="space-y-3">
		<h2 class="h2">{m.showcase_tiptap_editor()}</h2>
		<p class="text-sm text-surface-700-300">{m.showcase_tiptap_hint()}</p>
		{#key revision}
			<TiptapEditor {content} onUpdate={(next) => (content = next)} />
		{/key}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-surface-700-300">{m.showcase_tiptap_fixture()}</p>
			<Button type="button" variant="tonal" color="surface" onclick={reset}>
				{m.showcase_tiptap_reset()}
			</Button>
		</div>
	</section>

	<section class="space-y-3">
		<h2 class="h2">{m.showcase_tiptap_preview()}</h2>
		<Card>
			<TiptapPreview {content} />
		</Card>
	</section>
</main>
