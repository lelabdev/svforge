<script lang="ts">
	import { onMount } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * Graph node — maps to a force-graph node.
	 * `id` is required. All other fields are optional and can be used in custom renderers.
	 */
	interface GraphNode {
		id: string;
		/** Display label (shown on hover or as text) */
		label?: string;
		/** Node group/category — used for default coloring */
		group?: string;
		/** Custom color override (CSS color string) */
		color?: string;
		/** Node radius in pixels (default: 5) */
		val?: number;
		[key: string]: unknown;
	}

	/**
	 * Graph link — connects two nodes by id.
	 */
	interface GraphLink {
		source: string;
		target: string;
		/** Link label (shown on hover) */
		label?: string;
		/** Custom color override */
		color?: string;
		/** Link width in pixels */
		width?: number;
		[key: string]: unknown;
	}

	type PositionedGraphNode = GraphNode & { x?: number; y?: number };

	interface GraphInstance {
		graphData(data: { nodes: GraphNode[]; links: GraphLink[] }): GraphInstance;
		backgroundColor(color: string): GraphInstance;
		nodeLabel(accessor: (node: GraphNode) => string): GraphInstance;
		nodeColor(accessor: (node: GraphNode) => string): GraphInstance;
		linkWidth(width: number): GraphInstance;
		linkDirectionalArrowLength(length: number): GraphInstance;
		enableZoomInteraction(enabled: boolean): GraphInstance;
		warmupTicks(ticks: number): GraphInstance;
		linkHoverPrecision(precision: number): GraphInstance;
		nodeVal(accessor: number | ((node: GraphNode) => number)): GraphInstance;
		linkColor(accessor: string | ((link: GraphLink) => string)): GraphInstance;
		nodeCanvasObject(
			draw: (node: PositionedGraphNode, context: CanvasRenderingContext2D, globalScale: number) => void
		): GraphInstance;
		nodeCanvasObjectMode(mode: () => 'replace'): GraphInstance;
		onNodeClick(handler: (node: GraphNode, event: MouseEvent) => void): GraphInstance;
		onNodeHover(handler: (node: GraphNode | null, event: MouseEvent) => void): GraphInstance;
		onLinkClick(handler: (link: GraphLink, event: MouseEvent) => void): GraphInstance;
	}

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Graph nodes */
		nodes: GraphNode[];
		/** Graph links (edges) */
		links: GraphLink[];
		/** CSS width (default: '100%') */
		width?: string;
		/** CSS height (default: '400px') */
		height?: string;
		/** Background color (default: transparent) */
		bgColor?: string;
		/** Node color — string or function(node) => color */
		nodeColor?: string | ((node: GraphNode) => string);
		/** Node label — string field name or function(node) => string */
		nodeLabel?: string | ((node: GraphNode) => string);
		/** Node size — number or function(node) => number */
		nodeVal?: number | ((node: GraphNode) => number);
		/** Link color */
		linkColor?: string | ((link: GraphLink) => string);
		/** Link width */
		linkWidth?: number;
		/** Link directionality arrow */
		linkDirectionalArrowLength?: number;
		/** Show labels always (default: false — show on hover only) */
		showLabels?: boolean;
		/** Enable zoom/pan (default: true) */
		enableZoom?: boolean;
		/** Warmup ticks before rendering (default: 0) */
		warmupTicks?: number;
		/** Called when a node is clicked */
		onNodeClick?: (node: GraphNode, event: MouseEvent) => void;
		/** Called when a node is hovered */
		onNodeHover?: (node: GraphNode | null, event: MouseEvent) => void;
		/** Called when a link is clicked */
		onLinkClick?: (link: GraphLink, event: MouseEvent) => void;
		/** Additional class for the container */
		class?: string;
	}

	let {
		nodes = $bindable([]),
		links = $bindable([]),
		width = '100%',
		height = '400px',
		bgColor = 'transparent',
		nodeColor,
		nodeLabel = 'label',
		nodeVal,
		linkColor,
		linkWidth = 1,
		linkDirectionalArrowLength = 0,
		showLabels = false,
		enableZoom = true,
		warmupTicks = 0,
		onNodeClick,
		onNodeHover,
		onLinkClick,
		class: className = '',
		...rest
	}: Props = $props();

	let container: HTMLDivElement | undefined = $state();
	let graphInstance: GraphInstance | undefined = $state();

	// Group-based default colors — theme tokens (design-system check #240):
	// never raw hex inside svforge components.
	const groupColors = [
		'var(--color-primary-500)',
		'var(--color-secondary-500)',
		'var(--color-tertiary-500)',
		'var(--color-success-500)',
		'var(--color-warning-500)',
		'var(--color-error-500)',
		'var(--color-secondary-400)',
		'var(--color-primary-400)',
		'var(--color-warning-400)',
		'var(--color-success-400)'
	];

	function getNodeColor(node: GraphNode): string {
		if (node.color) return node.color;
		if (!node.group) return groupColors[0];
		// Stable color based on group name hash
		const hash = node.group.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
		return groupColors[Math.abs(hash) % groupColors.length];
	}

	function getNodeLabel(node: GraphNode): string {
		if (typeof nodeLabel === 'function') return nodeLabel(node);
		if (nodeLabel && nodeLabel !== 'label' && node[nodeLabel] != null) return String(node[nodeLabel]);
		return node.label ?? node.id;
	}

	onMount(async () => {
		if (!container) return;

		// Dynamic import — force-graph is client-only
		// The factory returns a value that is BOTH a chainable object and a
		// callable (ForceGraph()(container)); the shipped types only describe
		// the object shape, so the callable part needs an explicit cast (#284).
		const ForceGraph = (await import('force-graph')).default as unknown as () => (
			container: HTMLElement
		) => GraphInstance;

		const graph = ForceGraph()(container)
			.graphData({ nodes: [...nodes], links: [...links] })
			.backgroundColor(bgColor)
			.nodeLabel((node: GraphNode) => getNodeLabel(node))
			.nodeColor((node: GraphNode) => {
				if (nodeColor) {
					return typeof nodeColor === 'function' ? nodeColor(node) : nodeColor;
				}
				return getNodeColor(node);
			})
			.linkWidth(linkWidth)
			.linkDirectionalArrowLength(linkDirectionalArrowLength)
			.enableZoomInteraction(enableZoom)
			.warmupTicks(warmupTicks)
			.linkHoverPrecision(8);

		if (nodeVal !== undefined) {
			graph.nodeVal(typeof nodeVal === 'function' ? nodeVal : () => nodeVal);
		}

		if (linkColor) {
			graph.linkColor(typeof linkColor === 'function' ? linkColor : () => linkColor);
		} else {
			graph.linkColor(() => 'rgba(128, 128, 128, 0.3)');
		}

		if (showLabels) {
			graph.nodeCanvasObject((node: PositionedGraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
				const label = getNodeLabel(node);
				const fontSize = Math.max(12 / globalScale, 2);
				ctx.font = `${fontSize}px Sans-Serif`;
				const textWidth = ctx.measureText(label).width;
				const [x, y] = [node.x ?? 0, node.y ?? 0];

				// Background for readability
				ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
				ctx.fillRect(x - textWidth / 2 - 2, y - fontSize / 2 - 1, textWidth + 4, fontSize + 2);

				// Text
				ctx.fillStyle = '#fff';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(label, x, y);
			});
			graph.nodeCanvasObjectMode(() => 'replace');
		}

		if (onNodeClick) graph.onNodeClick(onNodeClick);
		if (onNodeHover) graph.onNodeHover(onNodeHover);
		if (onLinkClick) graph.onLinkClick(onLinkClick);

		graphInstance = graph;
	});

	// React to data changes
	$effect(() => {
		if (!graphInstance) return;
		// Touch nodes and links to track reactivity
		const _nodes = nodes;
		const _links = links;
		graphInstance.graphData({ nodes: [..._nodes], links: [..._links] });
	});
</script>

<div
	bind:this={container}
	class={className}
	style="width: {width}; height: {height};"
	{...rest}
></div>
