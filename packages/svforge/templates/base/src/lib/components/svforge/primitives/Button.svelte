<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import * as m from '$lib/paraglide/messages.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import type { ButtonOrAnchorProps } from './types';

	const presets = {
		filled: {
			primary: 'preset-filled-primary-400-600',
			secondary: 'preset-filled-secondary-400-600',
			tertiary: 'preset-filled-tertiary-400-600',
			success: 'preset-filled-success-400-600',
			warning: 'preset-filled-warning-400-600',
			error: 'preset-filled-error-400-600',
			surface: 'preset-filled-surface-400-600'
		},
		outlined: {
			primary: 'preset-outlined-primary-900-100',
			secondary: 'preset-outlined-secondary-900-100',
			tertiary: 'preset-outlined-tertiary-900-100',
			success: 'preset-outlined-success-900-100',
			warning: 'preset-outlined-warning-900-100',
			error: 'preset-outlined-error-900-100',
			surface: 'preset-outlined-surface-900-100'
		},
		tonal: {
			primary: 'preset-tonal-primary',
			secondary: 'preset-tonal-secondary',
			tertiary: 'preset-tonal-tertiary',
			success: 'preset-tonal-success',
			warning: 'preset-tonal-warning',
			error: 'preset-tonal-error',
			surface: 'preset-tonal-surface'
		},
		ghost: {
			primary: 'hover:preset-tonal-primary',
			secondary: 'hover:preset-tonal-secondary',
			tertiary: 'hover:preset-tonal-tertiary',
			success: 'hover:preset-tonal-success',
			warning: 'hover:preset-tonal-warning',
			error: 'hover:preset-tonal-error',
			surface: 'hover:preset-tonal-surface'
		}
	} as const;

	let {
		variant = 'filled',
		color = 'primary',
		size = 'md',
		href,
		loading = false,
		disabled = false,
		loadingLabel = m.common_loading(),
		type,
		class: className = '',
		children,
		...rest
	}: ButtonOrAnchorProps = $props();

	// `href` is the authoritative discriminant: a NON-EMPTY string renders the
	// anchor, anything else the button. The old `href && !disabled && !loading`
	// check was dishonest — it silently demoted disabled/loading links (and
	// `href=""`) to `<button>`s, contradicting the href discriminant (#321).
	const isAnchor = $derived(href !== undefined && href !== '');
	const inactive = $derived(disabled || loading);

	// Branch rest props never cross over (#321): the anchor spread explicitly
	// omits EVERY button-only attribute (name, form*, value, popovertarget*,
	// command*) — props smuggled in by consumers bypassing the type checker
	// never reach the <a>; the button spread strips anchor-only props (target,
	// rel, download…) symmetrically.
	const anchorRest = $derived.by(() => {
		const {
			onclick: _onclick, // never spread raw — wrapped by handleAnchorClick (#321)
			type: _type,
			name: _name,
			form: _form,
			formaction: _formaction,
			formenctype: _formenctype,
			formmethod: _formmethod,
			formnovalidate: _formnovalidate,
			formtarget: _formtarget,
			value: _value,
			popovertarget: _popovertarget,
			popovertargetaction: _popovertargetaction,
			popover: _popover,
			command: _command,
			commandfor: _commandfor,
			...attrs
		} = rest as HTMLButtonAttributes & HTMLAnchorAttributes;
		return attrs;
	});
	const buttonRest = $derived.by(() => {
		const {
			target: _target,
			rel: _rel,
			download: _download,
			hreflang: _hreflang,
			media: _media,
			ping: _ping,
			referrerpolicy: _referrerpolicy,
			...attrs
		} = rest as HTMLButtonAttributes & HTMLAnchorAttributes;
		return attrs;
	});

	// Activation gate (#321): a disabled/loading anchor stays focusable (the
	// aria-disabled pattern) but must be INERT. `pointer-events-none` blocks
	// the mouse, yet Enter on a focused anchor still dispatches a click event
	// and would navigate. Gating the activation (click, whether from mouse or
	// keyboard) covers both paths: inactive → preventDefault() blocks the
	// navigation and the consumer handler is skipped; active → call through.
	const handleAnchorClick: HTMLAnchorAttributes['onclick'] = (event) => {
		if (inactive) {
			event.preventDefault();
			return;
		}
		const consumer = (rest as HTMLAnchorAttributes).onclick;
		consumer?.(event);
	};

	// #317/#320: Skeleton v5 sizes are btn-xs…btn-9xl — the medium size
	// utility is `btn-base`; there is no invented medium size (svforge check
	// rejects it).
	const sizeClass = $derived(size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : 'btn-base');
	const presetClass = $derived(presets[variant]?.[color] ?? '');
	const classes = $derived(cn('btn focus-visible:ring-2 focus-visible:ring-primary-700-300', presetClass, sizeClass, className));
	// Anchors lack a native disabled presentation: reduced styling + pointer
	// events off stand in for it, aria-disabled announces it to AT.
	const anchorClasses = $derived(cn(classes, inactive && 'pointer-events-none opacity-50'));
</script>

{#snippet spinner()}
	<span
		aria-hidden="true"
		class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
	></span>
	<span class="sr-only">{loadingLabel}</span>
{/snippet}

{#if isAnchor}
	<!-- Anchor branch: a link styled as a button stays a link even when
	     visually disabled — aria-disabled + reduced styling, never a native
	     disabled attribute (invalid on <a>) and never a <button> fallback. -->
	<!-- Consumer attributes spread FIRST; href/class and the computed
	     aria-disabled / aria-busy land LAST so component state stays
	     authoritative — a consumer `aria-disabled="false"` cannot mask a
	     disabled/loading state (#321). The consumer onclick is gated through
	     handleAnchorClick: a disabled/loading anchor blocks activation
	     (preventDefault) instead of navigating on Enter/click (#321). -->
	<a
		{...anchorRest}
		{href}
		class={anchorClasses}
		aria-disabled={inactive || undefined}
		aria-busy={loading || undefined}
		onclick={handleAnchorClick}
	>
		{#if loading}
			{@render spinner()}
		{/if}
		{@render children()}
	</a>
{:else}
	<!-- Same pattern as the anchor branch: consumer rest props spread
	     FIRST, the component's computed state (type/disabled/aria-busy)
	     lands LAST — a consumer `aria-busy="false"` cannot mask loading
	     (#321). -->
	<button
		{...buttonRest}
		class={classes}
		type={type ?? 'button'}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
	>
		{#if loading}
			{@render spinner()}
		{/if}
		{@render children()}
	</button>
{/if}
