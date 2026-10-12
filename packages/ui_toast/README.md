# @svforge/ui_toast

Notification toasts for SVForge projects. Wraps Skeleton UI Toast.

## Installation

```bash
npx sv add @svforge/ui_toast
```

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none; this module is client-side UI only.

## Usage

Add `<Toaster />` to your root layout:

```svelte
<script>
  import { Toaster } from '#lib/components/svforge/ui/Toaster.svelte';
</script>

{@render children()}
<Toaster />
```

Trigger toasts from anywhere:

```ts
import { toaster } from '#lib/components/svforge/ui/toaster.js';

toaster.success({ title: 'Saved!', description: 'Your changes have been saved.' });
toaster.error({ title: 'Error', description: 'Something went wrong.' });
toaster.warning({ title: 'Warning' });
toaster.info({ title: 'Info' });
```

## What's included

- `Toaster.svelte` — singleton toast container (add to root layout)
- `toaster.ts` — shared toaster instance

## Dependencies

- `@skeletonlabs/skeleton-svelte` ^5.0.0 (peer)
