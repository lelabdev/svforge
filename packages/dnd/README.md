# @svforge/dnd

Drag & drop sortable lists for SVForge projects. Uses @thisux/sveltednd (native Svelte 5).

## Installation

```bash
npx sv add @svforge/dnd
```

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none; this module is client-side UI only.

## Usage

```svelte
<script>
  import SortableList from '#lib/components/svforge/dnd/SortableList.svelte';

  let items = $state([
    { id: '1', title: 'First item' },
    { id: '2', title: 'Second item' },
    { id: '3', title: 'Third item' },
  ]);
</script>

<SortableList items={items} onReorder={(newItems) => items = newItems}>
  {#snippet children(item)}
    <span>{item.title}</span>
  {/snippet}
</SortableList>
```

## What's included

- `SortableList.svelte` — generic sortable list with drag handles

## Dependencies

- `@thisux/sveltednd` — native Svelte 5 drag & drop library
- `@skeletonlabs/skeleton-svelte` ^5.0.0 (peer, classes de thème Skeleton — requiert le template svforge `base`)
