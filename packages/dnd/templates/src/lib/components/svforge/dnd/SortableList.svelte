<script lang="ts" generics="T extends { id: string | number }">
	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';
	import { cn } from '$lib/utils/cn';
	import type { Snippet } from 'svelte';

	interface Props {
		items: T[];
		onReorder?: (items: T[]) => void;
		children: Snippet<[T]>;
		class?: string;
	}

	let {
		items = $bindable([]),
		onReorder,
		children,
		class: className = ''
	}: Props = $props();

	let activeId: string | number | null = $state(null);
	let overIndex: number | null = $state(null);

	function handleDragStart(state: DragDropState<T>) {
		activeId = state.draggedItem.id;
	}

	function handleDragEnd() {
		activeId = null;
		overIndex = null;
	}

	function handleDragEnter(state: DragDropState<T>) {
		overIndex = state.targetContainer ? Number(state.targetContainer) : null;
	}

	function handleDrop(state: DragDropState<T>) {
		const { draggedItem, targetContainer } = state;

		if (!targetContainer) {
			handleDragEnd();
			return;
		}

		const fromIndex = items.findIndex((item) => item.id === draggedItem.id);
		const toIndex = Number(targetContainer);

		if (fromIndex === -1 || Number.isNaN(toIndex) || fromIndex === toIndex) {
			handleDragEnd();
			return;
		}

		const next = [...items];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		items = next;

		onReorder?.(next);
		handleDragEnd();
	}
</script>

<ul class="space-y-2 {className}">
	{#each items as item, index (item.id)}
		<li
			use:droppable={{
				container: index.toString(),
				callbacks: {
					onDragEnter: handleDragEnter,
					onDrop: handleDrop
				}
			}}
			use:draggable={{
				container: index.toString(),
				dragData: item,
				callbacks: {
					onDragStart: handleDragStart,
					onDragEnd: handleDragEnd
				}
			}}
			class={cn(
				'flex items-center gap-3 p-3 rounded-lg border border-surface-200-800 bg-surface-50-950 cursor-grab active:cursor-grabbing transition-all',
				activeId === item.id && 'opacity-50 scale-[0.98]',
				overIndex === index && activeId !== item.id && 'border-primary-500 bg-primary-500/5'
			)}
		>
			<span class="text-surface-400-600 select-none text-lg" aria-hidden="true">⠿</span>
			<div class="flex-1">
				{@render children(item)}
			</div>
		</li>
	{/each}
</ul>
