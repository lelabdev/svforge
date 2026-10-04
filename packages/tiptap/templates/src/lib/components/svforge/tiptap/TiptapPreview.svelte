<script lang="ts">
	import type { JSONContent } from '@tiptap/core';
	import { cn } from '$lib/utils/cn';
	import { renderTiptap } from './render-tiptap';

	interface Props {
		content: JSONContent;
		class?: string;
	}

	let { content, class: className = '' }: Props = $props();

	// The sanitization lives in the pure renderTiptap() function (#282) — every
	// document-controlled value is escaped or allowlisted there before reaching
	// the {@html} output. The .svelte itself must never interpolate
	// document attributes into HTML.
	const renderedHtml = $derived(renderTiptap(content));
</script>

<div
	class={cn(
		'prose max-w-none dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-300 prose-headings:text-surface-950-50 prose-blockquote:border-primary-500 prose-pre:bg-surface-100-900 prose-pre:text-surface-950-50 prose-code:bg-surface-100-900 prose-code:text-surface-950-50',
		className
	)}
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html renderedHtml}
</div>
