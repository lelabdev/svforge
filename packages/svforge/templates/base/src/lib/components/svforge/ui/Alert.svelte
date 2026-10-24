<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Variant = 'info' | 'success' | 'warning' | 'error';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: Variant;
		class?: string;
		children: Snippet;
	}

	let { variant = 'info', class: className = '', children, ...rest }: Props = $props();

	const presets: Record<Variant, string> = {
		// #317/#320: Skeleton v5 has no info color — the informational variant
		// maps to the theme's primary tonal preset: an invented info tonal preset
		// renders UNSTYLED in v5.
		info: 'preset-tonal-primary',
		success: 'preset-tonal-success',
		warning: 'preset-tonal-warning',
		error: 'preset-tonal-error'
	};
</script>

<div class={cn('card p-2', presets[variant], className)} {...rest}>
	{@render children()}
</div>
