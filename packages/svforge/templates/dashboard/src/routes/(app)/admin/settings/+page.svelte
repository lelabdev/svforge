<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { Card, AvatarInitial, Feedback } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { Lock } from '$lib/icons';
	import type { ActionData } from './$types';

	let { data, form }: { data: { user: { id: string; name: string; email: string } | null }, form: ActionData } = $props();
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');

	// Client-side validation — cleared on form response, not via $effect
	let validationError = $state('');
</script>

<svelte:head>
	<title>{m.settings_title()}</title>
</svelte:head>

<div class="max-w-2xl space-y-8">
	<h2 class="h2">{m.settings_heading()}</h2>

	<!-- Profile info -->
	<Card>
		{#snippet header()}
			<h3 class="h3">{m.settings_profile()}</h3>
		{/snippet}
		<div class="space-y-3">
			<div class="flex items-center gap-4">
				<AvatarInitial name={data.user?.name ?? ''} size="lg" />
				<div>
					<p class="font-medium">{data.user?.name}</p>
					<p class="text-sm text-surface-700-300">{data.user?.email}</p>
				</div>
			</div>
		</div>
	</Card>

	<!-- Change password -->
	<Card>
		{#snippet header()}
			<div class="flex items-center gap-2">
				<Lock size={18} />
				<h3 class="h3">{m.settings_change_password()}</h3>
			</div>
		{/snippet}

		{#if form?.message}
			<Feedback type={form.success ? 'success' : 'error'} message={form.message} class="mb-4" />
		{/if}
		{#if validationError}
			<!-- #317: reuse the Feedback component — the hand-rolled bg-error-100-900
			     strip re-implemented what Feedback (preset-tonal-error) already owns. -->
			<Feedback type="error" message={validationError} class="mb-4" />
		{/if}

		<form method="POST" action="?/changePassword" onsubmit={(e) => {
				if (newPassword !== confirmPassword) {
					e.preventDefault();
					validationError = m.settings_password_mismatch();
				} else {
					validationError = '';
				}
			}} use:enhance class="space-y-4">
			<Input label={m.settings_current_password()} type="password" name="currentPassword" bind:value={currentPassword} required />
			<Input label={m.settings_new_password()} type="password" name="newPassword" bind:value={newPassword} placeholder={m.common_min_chars()} required />
			<Input label={m.settings_confirm_password()} type="password" name="confirmPassword" bind:value={confirmPassword} required />
			<div class="flex justify-end">
				<Button type="submit">{m.settings_update_password()}</Button>
			</div>
		</form>
	</Card>
</div>
