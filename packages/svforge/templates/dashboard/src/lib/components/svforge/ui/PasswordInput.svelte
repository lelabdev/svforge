<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import { Eye, EyeSlash } from '#lib/icons/index.js';
	import { Button, Input } from '#lib/components/svforge/primitives/index.js';

	/**
	 * Password field with a visibility toggle (#603).
	 *
	 * The login and setup screens used to hand-roll the same `Input` + eye
	 * `Button` + local `passwordVisible` state. The composition now lives once:
	 * the primitive still owns the label, error and input markup, this component
	 * only owns the reveal affordance and its accessible state.
	 *
	 * It deliberately stays a *field*, not a form: submission, validation rules
	 * and localized copy remain with the route that owns them.
	 */
	interface Props {
		/** Visible field label. */
		label?: string;
		/** Form field name posted by the native form. */
		name: string;
		/** Bound password value. */
		value?: string;
		/** Browser autofill hint: `current-password` (sign in) or `new-password`. */
		autocomplete?: 'current-password' | 'new-password' | 'off';
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		/** Validation message rendered by the Input primitive. */
		error?: string;
		class?: string;
	}

	let {
		label,
		name,
		value = $bindable(''),
		autocomplete = 'current-password',
		placeholder,
		required = false,
		disabled = false,
		error,
		class: className
	}: Props = $props();

	let visible = $state(false);
	const toggleLabel = $derived(visible ? m.common_hide_password() : m.common_show_password());
</script>

<Input
	{label}
	{name}
	{error}
	{disabled}
	{required}
	{placeholder}
	{autocomplete}
	type={visible ? 'text' : 'password'}
	bind:value
	class={className}
>
	{#snippet trailing()}
		<Button
			type="button"
			variant="ghost"
			color="surface"
			class="size-11 shrink-0 p-0"
			aria-label={toggleLabel}
			aria-pressed={visible}
			{disabled}
			onclick={() => (visible = !visible)}
		>
			{#if visible}<EyeSlash size={18} />{:else}<Eye size={18} />{/if}
		</Button>
	{/snippet}
</Input>
