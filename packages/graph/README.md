# @svforge/graph

Interactive knowledge graph visualization for SvelteKit — Obsidian-style force-directed graph.

## Installation

```bash
npx sv add @svforge/graph
```

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none; this is a client-side visualization.

## Usage

```svelte
<script>
import { KnowledgeGraph } from '#lib/components/svforge/graph/index.js';

const nodes = [
{ id: '1', label: 'Svelte', group: 'framework' },
{ id: '2', label: 'Skeleton', group: 'ui' }
];

const links = [
{ source: '1', target: '2' }
];
</script>

<KnowledgeGraph {nodes} {links} height="500px" />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodes` | `GraphNode[]` | `[]` | Graph nodes (id required) |
| `links` | `GraphLink[]` | `[]` | Graph edges (source + target) |
| `width` | `string` | `'100%'` | CSS width |
| `height` | `string` | `'400px'` | CSS height |
| `bgColor` | `string` | `'transparent'` | Background color |
| `nodeColor` | `string \| (node) => string` | auto | Node color override |
| `nodeLabel` | `string \| (node) => string` | `'label'` | Node label field or function |
| `nodeVal` | `number \| (node) => number` | `5` | Node radius |
| `linkColor` | `string \| (link) => string` | auto | Link color |
| `linkWidth` | `number` | `1` | Link width in px |
| `showLabels` | `boolean` | `false` | Always show labels |
| `enableZoom` | `boolean` | `true` | Enable zoom/pan |
| `onNodeClick` | `(node, event) => void` | - | Node click callback |
| `onNodeHover` | `(node, event) => void` | - | Node hover callback |
| `onLinkClick` | `(link, event) => void` | - | Link click callback |

## Features

- Group-based automatic coloring (hash-based stable palette)
- Labels on hover or always visible
- Zoom and pan support
- Reactive data updates via `$effect`
- Client-only via dynamic import (no SSR issues)

## License

MIT
