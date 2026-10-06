<script lang="ts">
	import type { JSONContent } from '@tiptap/core';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/env';
	import { cn } from '$lib/utils/cn';
	import { getToolbarState } from './toolbar-state';
	import { applyTiptapLink, removeTiptapLink } from './link-actions';
	import TiptapToolbar from './TiptapToolbar.svelte';

	interface Props {
		content: JSONContent;
		onUpdate?: (content: JSONContent) => void;
		class?: string;
	}

	let { content, onUpdate, class: className = '' }: Props = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let editorInstance: any = $state(null);
	let editorElement: HTMLElement;
	let loading = $state(true);
	let activeFormats = $state<string[]>([]);
	let activeHeading = $state<string[]>([]);
	let activeLists = $state<string[]>([]);
	let activeBlocks = $state<string[]>([]);
	let activeLink = $state(false);
	let linkHref = $state('');

	function syncToolbarState(editor = editorInstance) {
		const state = getToolbarState(editor);
		activeFormats = state.activeFormats;
		activeHeading = state.activeHeading;
		activeLists = state.activeLists;
		activeBlocks = state.activeBlocks;
		activeLink = state.activeLink;
		linkHref = state.activeLink ? editor?.getAttributes('link')?.href ?? '' : '';
	}

	onMount(async () => {
		if (!browser) return;

		try {
			const [
				coreModule,
				starterKitModule,
				underlineModule,
				linkModule,
				extensionsModule
			] = await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/starter-kit'),
				import('@tiptap/extension-underline'),
				import('@tiptap/extension-link'),
				import('./tiptap-extensions')
			]);

			const EditorClass = coreModule.Editor;
			const StarterKit = starterKitModule.default;
			const Underline = underlineModule.default;
			const Link = linkModule.default;
			const { VisualHeading } = extensionsModule;

			editorInstance = new EditorClass({
				element: editorElement,
				extensions: [
					StarterKit.configure({ heading: false }),
					Underline,
					Link.configure({ openOnClick: false }),
					VisualHeading
				],
				content: content,
				editorProps: {
					attributes: {
						class: 'prose max-w-none dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-300 prose-headings:text-surface-950-50 prose-blockquote:border-primary-500 prose-pre:bg-surface-100-900 prose-pre:text-surface-950-50 prose-code:bg-surface-100-900 prose-code:text-surface-950-50 focus:outline-none min-h-[300px] p-4'
					}
				},
				onUpdate: ({ editor }: { editor: typeof editorInstance }) => {
					onUpdate?.(editor.getJSON());
					syncToolbarState(editor);
				},
				onSelectionUpdate: ({ editor }: { editor: typeof editorInstance }) => {
					syncToolbarState(editor);
				}
			});
			syncToolbarState();
		} catch (error) {
			console.error('Failed to load Tiptap editor:', error);
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		if (editorInstance) {
			editorInstance.destroy();
			editorInstance = null;
		}
	});

	const actions = {
		toggleBold: () => editorInstance?.chain().focus().toggleBold().run(),
		toggleItalic: () => editorInstance?.chain().focus().toggleItalic().run(),
		toggleUnderline: () => editorInstance?.chain().focus().toggleUnderline().run(),
		toggleStrike: () => editorInstance?.chain().focus().toggleStrike().run(),
		toggleBulletList: () => editorInstance?.chain().focus().toggleBulletList().run(),
		toggleOrderedList: () => editorInstance?.chain().focus().toggleOrderedList().run(),
		toggleBlockquote: () => editorInstance?.chain().focus().toggleBlockquote().run(),
		toggleCode: () => editorInstance?.chain().focus().toggleCodeBlock().run(),
		setHeading: (level: 1 | 2 | 3) =>
			editorInstance?.chain().focus().setVisualHeading({ level }).run(),
		unsetHeading: () => editorInstance?.chain().focus().unsetVisualHeading().run(),
		applyLink: (href: string) => applyTiptapLink(editorInstance, href),
		removeLink: () => removeTiptapLink(editorInstance)
	};
</script>

<div class={cn('overflow-hidden rounded-container border border-surface-200-800 bg-surface-50-950', className)}>
	<TiptapToolbar
		{loading}
		{activeFormats}
		{activeHeading}
		{activeLists}
		{activeBlocks}
		{activeLink}
		{linkHref}
		onToggleBold={actions.toggleBold}
		onToggleItalic={actions.toggleItalic}
		onToggleUnderline={actions.toggleUnderline}
		onToggleStrike={actions.toggleStrike}
		onToggleBulletList={actions.toggleBulletList}
		onToggleOrderedList={actions.toggleOrderedList}
		onToggleBlockquote={actions.toggleBlockquote}
		onToggleCode={actions.toggleCode}
		onApplyLink={actions.applyLink}
		onRemoveLink={actions.removeLink}
		onSetHeading={actions.setHeading}
		onUnsetHeading={actions.unsetHeading}
	/>

	<div class="min-h-[300px] relative" bind:this={editorElement} class:opacity-50={loading}>
		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="w-8 h-8 border-3 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
			</div>
		{/if}
	</div>
</div>
