<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/svforge/primitives';
	import { cn } from '$lib/utils/cn';
	import { ToggleGroup } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		loading: boolean;
		activeFormats: string[];
		activeHeading: string[];
		activeLists: string[];
		activeBlocks: string[];
		activeLink: boolean;
		onToggleBold: () => void;
		onToggleItalic: () => void;
		onToggleUnderline: () => void;
		onToggleStrike: () => void;
		onToggleBulletList: () => void;
		onToggleOrderedList: () => void;
		onToggleBlockquote: () => void;
		onToggleCode: () => void;
		onSetLink: () => void;
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
		onToggleBold,
		onToggleItalic,
		onToggleUnderline,
		onToggleStrike,
		onToggleBulletList,
		onToggleOrderedList,
		onToggleBlockquote,
		onToggleCode,
		onSetLink,
		onSetHeading,
		onUnsetHeading
	}: Props = $props();

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

		<Button
			variant={activeLink ? 'tonal' : 'ghost'}
			color={activeLink ? 'primary' : 'surface'}
			size="sm"
			class="shrink-0"
			aria-pressed={activeLink}
			onclick={onSetLink}
			title={m.tiptap_insert_link()}
		>
			{m.tiptap_link()}
		</Button>
	{/if}
</div>
