<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface CheckedChangeDetails {
		checked: boolean;
	}

	interface Props {
		/** Visible label rendered as the switch label. */
		label?: string;
		checked?: boolean;
		/** Hidden-input name — carries the toggle state in native form submissions. */
		name?: string;
		disabled?: boolean;
		required?: boolean;
		/** Associates the switch with a `<form>` by id. */
		form?: string;
		onCheckedChange?: (details: CheckedChangeDetails) => void;
		/**
		 * Typed DOM handlers, forwarded to the underlying hidden input.
		 * Skeleton composes (never replaces) its internal handlers, so the
		 * machine state stays in sync alongside consumer listeners.
		 */
		onchange?: HTMLInputAttributes['onchange'];
		onblur?: HTMLInputAttributes['onblur'];
		onfocus?: HTMLInputAttributes['onfocus'];
		onclick?: HTMLInputAttributes['onclick'];
		oninput?: HTMLInputAttributes['oninput'];
		onkeydown?: HTMLInputAttributes['onkeydown'];
		onkeyup?: HTMLInputAttributes['onkeyup'];
		/** Custom classes go on the switch track (control), not the label. */
		class?: string;
	}

	let {
		label,
		checked = $bindable(false),
		name,
		disabled,
		required,
		form,
		onCheckedChange,
		onchange,
		onblur,
		onfocus,
		onclick,
		oninput,
		onkeydown,
		onkeyup,
		class: className = ''
	}: Props = $props();

	// Thin composition over the official Skeleton Switch (#321): the wrapper
	// only adds the `label` + `bind:checked` ergonomics — markup, styling,
	// keyboard support, ARIA and SSR-stable ids come from @skeletonlabs/
	// skeleton-svelte. The hidden input keeps native form participation.
	function handleChange(details: CheckedChangeDetails) {
		checked = details.checked;
		onCheckedChange?.(details);
	}
</script>

<Switch {checked} {name} {disabled} {required} {form} onCheckedChange={handleChange}>
	<Switch.Control class={cn('focus-visible:ring-2 focus-visible:ring-primary-700-300', className)}>
		<Switch.Thumb />
	</Switch.Control>
	{#if label}
		<Switch.Label>{label}</Switch.Label>
	{/if}
	<Switch.HiddenInput {onchange} {onblur} {onfocus} {onclick} {oninput} {onkeydown} {onkeyup} />
</Switch>
