<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import * as m from '$lib/paraglide/messages.js';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { cn } from '$lib/utils/cn';
	import { isSafeHref } from './render-tiptap';
	import { Popover, Portal, ToggleGroup } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		loading: boolean;
		activeFormats: string[];
		activeHeading: string[];
		activeLists: string[];
		activeBlocks: string[];
		activeLink: boolean;
		linkHref: string;
		onToggleBold: () => void;
		onToggleItalic: () => void;
		onToggleUnderline: () => void;
		onToggleStrike: () => void;
		onToggleBulletList: () => void;
		onToggleOrderedList: () => void;
		onToggleBlockquote: () => void;
		onToggleCode: () => void;
		onApplyLink: (href: string) => void;
		onRemoveLink: () => void;
		onSetHeading: (level: 1 | 2 | 3) => void;
		onUnsetHeading: () => void;
	}

	let {
		loading,
		activeFormats,
		activeHeading,
		activeLists,
		activeBlocks,
		activeLink,
		linkHref,
		onToggleBold,
		onToggleItalic,
		onToggleUnderline,
		onToggleStrike,
		onToggleBulletList,
		onToggleOrderedList,
		onToggleBlockquote,
		onToggleCode,
		onApplyLink,
		onRemoveLink,
		onSetHeading,
		onUnsetHeading
	}: Props = $props();

	const linkInputId = $props.id();
	let linkPopoverOpen = $state(false);
	let linkUrl = $state('');
	let linkUrlError = $state('');

	function handleLinkPopoverChange(details: { open: boolean }) {
		if (details.open) {
			linkUrl = linkHref;
			linkUrlError = '';
		}
		linkPopoverOpen = details.open;
	}

	function applyLink(event: SubmitEvent) {
		event.preventDefault();
		const href = linkUrl.trim();
		if (!isSafeHref(href)) {
			linkUrlError = m.tiptap_link_invalid_url();
			return;
		}
		linkUrlError = '';
		onApplyLink(href);
		linkPopoverOpen = false;
	}

	type ToggleControl = { value: string; label: string; title: string };

	const formatControls: ToggleControl[] = $derived([
		{ value: 'bold', label: 'B', title: m.tiptap_bold() },
		{ value: 'italic', label: 'I', title: m.tiptap_italic() },
		{ value: 'underline', label: 'U', title: m.tiptap_underline() },
		{ value: 'strike', label: 'S', title: m.tiptap_strikethrough() }
	]);
	const headingControls: ToggleControl[] = $derived(
		([1, 2, 3] as const).map((level) => ({
			value: String(level),
			label: `H${level}`,
			title: m.tiptap_heading({ level })
		}))
	);
	const listControls: ToggleControl[] = $derived([
		{ value: 'bulletList', label: '•', title: m.tiptap_bullet_list() },
		{ value: 'orderedList', label: '1.', title: m.tiptap_ordered_list() }
	]);
	const blockControls: ToggleControl[] = $derived([
		{ value: 'blockquote', label: '❝', title: m.tiptap_blockquote() },
		{ value: 'codeBlock', label: '</>', title: m.tiptap_code_block() }
	]);

	const itemClass = (selected: boolean) =>
		cn(
			'btn btn-sm min-w-8 justify-center',
			selected ? 'preset-filled-primary-500' : 'preset-tonal-surface'
		);
	const formatLabelClass = (value: string) => {
		if (value === 'bold') return 'font-bold';
		if (value === 'italic') return 'italic';
		if (value === 'underline') return 'underline';
		return 'line-through';
	};

	function handleFormatChange(nextValues: string[]) {
		const next = new Set(nextValues);
		const current = new Set(activeFormats);
		for (const [value, action] of [
			['bold', onToggleBold],
			['italic', onToggleItalic],
			['underline', onToggleUnderline],
			['strike', onToggleStrike]
		] as const) {
			if (next.has(value) !== current.has(value)) action();
		}
	}

	function handleHeadingChange(nextValues: string[]) {
		const selected = nextValues[0];
		if (selected === undefined) {
			if (activeHeading.length > 0) onUnsetHeading();
			return;
		}
		onSetHeading(Number(selected) as 1 | 2 | 3);
	}

</script>

<div
	role="toolbar"
	aria-label={m.tiptap_toolbar()}
	class="flex flex-wrap items-center gap-2 rounded-t-container border-b border-surface-200-800 bg-surface-100-900 p-2"
>
	{#if loading}
		<div class="flex items-center gap-2 px-3 py-1 text-sm text-surface-500">
			<div class="h-4 w-4 animate-spin rounded-full border-2 border-surface-300-700 border-t-primary-500"></div>
			<span class="text-xs uppercase tracking-widest">{m.tiptap_loading()}</span>
		</div>
	{:else}
		<ToggleGroup
			aria-label={m.tiptap_toolbar_formatting()}
			class="flex items-center gap-1 border-r border-surface-200-800 pr-2"
			multiple
			value={activeFormats}
			onValueChange={({ value }) => handleFormatChange(value)}
		>
			{#each formatControls as control (control.value)}
				<ToggleGroup.Item
					type="button"
					value={control.value}
					class={itemClass(activeFormats.includes(control.value))}
					aria-label={control.title}
					title={control.title}
				>
					<span class={formatLabelClass(control.value)} aria-hidden="true">{control.label}</span>
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup>

		<ToggleGroup
			aria-label={m.tiptap_toolbar_headings()}
			class="flex items-center gap-1 border-r border-surface-200-800 pr-2"
			value={activeHeading}
			onValueChange={({ value }) => handleHeadingChange(value)}
		>
			{#each headingControls as control (control.value)}
				<ToggleGroup.Item
					type="button"
					value={control.value}
					class={itemClass(activeHeading.includes(control.value))}
					aria-label={control.title}
					title={control.title}
				>
					{control.label}
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup>

		<div
			role="group"
			aria-label={m.tiptap_toolbar_lists()}
			class="flex items-center gap-1 border-r border-surface-200-800 pr-2"
		>
			{#each listControls as control (control.value)}
				<Button
					type="button"
					size="sm"
					variant={activeLists.includes(control.value) ? 'tonal' : 'ghost'}
					color={activeLists.includes(control.value) ? 'primary' : 'surface'}
					aria-pressed={activeLists.includes(control.value)}
					aria-label={control.title}
					title={control.title}
					onclick={control.value === 'bulletList' ? onToggleBulletList : onToggleOrderedList}
				>
					{control.label}
				</Button>
			{/each}
		</div>

		<div
			role="group"
			aria-label={m.tiptap_toolbar_blocks()}
			class="flex items-center gap-1 border-r border-surface-200-800 pr-2"
		>
			{#each blockControls as control (control.value)}
				<Button
					type="button"
					size="sm"
					variant={activeBlocks.includes(control.value) ? 'tonal' : 'ghost'}
					color={activeBlocks.includes(control.value) ? 'primary' : 'surface'}
					aria-pressed={activeBlocks.includes(control.value)}
					aria-label={control.title}
					title={control.title}
					onclick={control.value === 'blockquote' ? onToggleBlockquote : onToggleCode}
				>
					{control.label}
				</Button>
			{/each}
		</div>

		{#snippet linkTrigger(attributes: HTMLButtonAttributes)}
			<button
				{...attributes}
				type="button"
				class={cn(
					'btn btn-sm shrink-0',
					activeLink ? 'preset-tonal-primary' : 'hover:preset-tonal-surface'
				)}
				aria-pressed={activeLink}
				title={activeLink ? m.tiptap_edit_link() : m.tiptap_insert_link()}
			>
				{m.tiptap_link()}
			</button>
		{/snippet}

		<Popover
			open={linkPopoverOpen}
			onOpenChange={handleLinkPopoverChange}
			initialFocusEl={() => document.getElementById(linkInputId)}
			closeOnInteractOutside={true}
			restoreFocus={true}
		>
			<Popover.Trigger element={linkTrigger} />
			<Portal>
				<Popover.Positioner class="z-50">
					<Popover.Content class="card w-80 space-y-3 border border-surface-200-800 bg-surface-50-950 p-4 shadow-lg">
						<Popover.Title class="font-semibold">
							{activeLink ? m.tiptap_edit_link() : m.tiptap_insert_link()}
						</Popover.Title>
						<Popover.Description class="text-sm text-surface-500">
							{m.tiptap_link_description()}
						</Popover.Description>
						<form class="space-y-3" onsubmit={applyLink}>
							<Input
								id={linkInputId}
								label={m.tiptap_link_url()}
								type="text"
								bind:value={linkUrl}
								error={linkUrlError}
								oninput={() => (linkUrlError = '')}
								required
							/>
							<div class="flex flex-wrap justify-end gap-2">
								{#if activeLink}
									<Button
										type="button"
										variant="outlined"
										color="warning"
										size="sm"
										onclick={() => {
											onRemoveLink();
											linkPopoverOpen = false;
										}}
									>
										{m.tiptap_link_remove()}
									</Button>
								{/if}
								<Popover.CloseTrigger
									class="btn btn-sm hover:preset-tonal-surface"
									aria-label={m.tiptap_link_cancel()}
								>
									{m.tiptap_link_cancel()}
								</Popover.CloseTrigger>
								<Button type="submit" size="sm">
									{activeLink ? m.tiptap_link_update() : m.tiptap_link_apply()}
								</Button>
							</div>
						</form>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	{/if}
</div>
