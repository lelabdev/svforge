<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { enhance } from '$app/forms';
	import AuthLayout from '$lib/components/svforge/layout/AuthLayout.svelte';
	import { Feedback } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { Eye, EyeSlash } from '$lib/icons';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let name = $state(untrack(() => form?.name ?? ''));
	let email = $state(untrack(() => form?.email ?? ''));
	let password = $state('');
	let passwordVisible = $state(false);
	let loading = $state(false);

	function setupError(code: string | undefined) {
		switch (code) {
			case 'invalid_input':
				return m.setup_error_invalid_input();
			case 'admin_exists':
				return m.setup_error_admin_exists();
			case 'create_failed':
				return m.setup_error_create_failed();
			default:
				return m.common_error();
		}
	}
</script>

<svelte:head>
	<title>{m.setup_title()}</title>
</svelte:head>

<AuthLayout title={m.setup_create_admin()} description={m.setup_hint()}>
	{#if form?.code}
		<Feedback type="error" message={setupError(form.code)} class="mb-6" />
	{/if}

	<form
		method="POST"
		class="space-y-5"
		use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				try {
					await update({ reset: false });
				} finally {
					loading = false;
				}
			};
		}}
	>
		<Input
			name="name"
			label={m.users_label_name()}
			autocomplete="name"
			bind:value={name}
			placeholder={m.users_placeholder_name()}
			required
		/>
		<Input
			name="email"
			label={m.login_label_email()}
			type="email"
			autocomplete="email"
			bind:value={email}
			placeholder={m.users_placeholder_email()}
			required
		/>
		<Input
			name="password"
			label={m.login_label_password()}
			type={passwordVisible ? 'text' : 'password'}
			autocomplete="new-password"
			bind:value={password}
			placeholder={m.common_min_chars()}
			required
		>
			{#snippet trailing()}
				<Button
					type="button"
					variant="ghost"
					color="surface"
					class="size-11 shrink-0 p-0"
					aria-label={passwordVisible ? m.common_hide_password() : m.common_show_password()}
					aria-pressed={passwordVisible}
					onclick={() => (passwordVisible = !passwordVisible)}
				>
					{#if passwordVisible}<EyeSlash size={18} />{:else}<Eye size={18} />{/if}
				</Button>
			{/snippet}
		</Input>
		<div class="pt-2">
			<Button type="submit" class="min-h-11 w-full" loading={loading} loadingLabel={m.common_loading()}>
				{loading ? m.common_loading() : m.setup_submit()}
			</Button>
		</div>
	</form>

	{#snippet footnote()}
		<p>{m.setup_dev_only()}</p>
	{/snippet}
</AuthLayout>
