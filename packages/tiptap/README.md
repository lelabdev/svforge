# @svforge/tiptap

Rich text editor for SVForge projects. Powered by Tiptap with a built-in toolbar and preview renderer.

## Installation

```bash
npx sv add @svforge/tiptap
```

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none; the editor runs in the browser.

## Usage

### Editor (editable)

```svelte
<script>
  import { TiptapEditor } from '$lib/components/svforge/tiptap';
  import type { JSONContent } from '@tiptap/core';

  let content = $state<JSONContent>({ type: 'doc', content: [] });
</script>

<TiptapEditor
  content={content}
  onUpdate={(json) => content = json}
/>
```

### Preview (read-only)

```svelte
<script>
  import { TiptapPreview } from '$lib/components/svforge/tiptap';
</script>

<TiptapPreview content={savedContent} />
```

### Editor + Preview side by side

```svelte
<script>
  import { TiptapEditor, TiptapPreview } from '$lib/components/svforge/tiptap';
  import type { JSONContent } from '@tiptap/core';

  let content = $state<JSONContent>({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start writing...' }] }]
  });
</script>

<div class="grid grid-cols-2 gap-4">
  <TiptapEditor content={content} onUpdate={(json) => content = json} />
  <TiptapPreview content={content} />
</div>
```

## Storage

Tiptap content is JSON (`JSONContent`). Save it as-is in your database:

```ts
// Save to DB
await db.insert(posts).values({ content: JSON.stringify(content) });

// Load from DB
const content = JSON.parse(row.content) as JSONContent;
```

## Toolbar buttons

Bold, Italic, Underline, Strikethrough, H1-H3, Bullet list, Ordered list, Blockquote, Code block, Link.

## What's included

- `TiptapEditor.svelte` — full editor with toolbar
- `TiptapToolbar.svelte` — accessible Skeleton ToggleGroup controls and the base Button primitive
- `TiptapPreview.svelte` — lightweight JSON→HTML renderer (no editor loaded)
- `tiptap-extensions.ts` — VisualHeading node

## Dependencies

- `@tiptap/core` — editor engine
- `@tiptap/starter-kit` — bold, italic, lists, code, blockquote, etc.
- `@tiptap/extension-underline` — underline formatting
- `@tiptap/extension-link` — link support

> Requires the SVForge `base` template for Skeleton theme utilities, the `Button` primitive, Paraglide messages, and the `@skeletonlabs/skeleton-svelte` ToggleGroup. No extra UI library is added.
