<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { AvatarInitial, Feedback, Table } from '$lib/components/svforge/ui';
	import { Badge } from '$lib/components/svforge/primitives';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { UserPlus, EnvelopeSimple, Power, Pencil, X } from '$lib/icons';
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';

	let { data }: { data: PageData } = $props();
	let currentUserId = $derived(page.data.user?.id);

	let search = $state('');
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	// Modal state
	let modal = $state<'create' | 'edit' | 'status' | 'invite' | null>(null);
	let editUser = $state<{ id: string; name: string; email: string } | null>(null);
	let statusTarget = $state<{ id: string; name: string; disabled: boolean } | null>(null);

	// Form fields
	let formName = $state('');
	let formEmail = $state('');
	let formPassword = $state('');

	// The Table primitive is generic (#321): the cell snippet receives rows
	// already typed as UserRow — no cast-recovery needed.
	// Columns are re-derived so Paraglide labels stay reactive to the locale.
	let columns = $derived([
		{ key: 'name', label: m.users_name() },
		{ key: 'email', label: m.users_email(), class: 'hidden sm:table-cell' },
		{ key: 'status', label: m.users_status() },
		{ key: 'actions', label: m.users_actions(), class: 'text-right' }
	]);

	let filtered = $derived(
		data.users.filter(
			(u) =>
				u.name.toLowerCase().includes(search.toLowerCase()) ||
				u.email.toLowerCase().includes(search.toLowerCase())
		)
	);

	function openCreate() {
		formName = '';
		formEmail = '';
		formPassword = '';
		modal = 'create';
	}

	function openInvite() {
		formEmail = '';
		modal = 'invite';
	}

	function openEdit(u: { id: string; name: string; email: string }) {
		editUser = { id: u.id, name: u.name, email: u.email };
		formName = u.name;
		formEmail = u.email;
		modal = 'edit';
	}

	function openStatus(u: { id: string; name: string; disabled: boolean }) {
		statusTarget = { id: u.id, name: u.name, disabled: u.disabled };
		modal = 'status';
	}

	function closeModal() {
		modal = null;
		editUser = null;
		statusTarget = null;
	}

	/**
	 * Stable server codes → localized feedback (#295). The server never sends
	 * English copy: every visible message is a Paraglide message mapped here.
	 */
	function feedbackFor(code: string | undefined, isError: boolean): string {
		if (!isError) {
			switch (code) {
				case 'created':
					return m.users_created();
				case 'updated':
					return m.users_updated();
				case 'deactivated':
					return m.users_deactivated();
				case 'reactivated':
					return m.users_reactivated();
				case 'verified':
					return m.users_verified_ok();
				case 'unverified':
					return m.users_unverified();
				case 'invited':
					return m.users_invited();
				default:
					return m.users_created();
			}
		}
		switch (code) {
			case 'email_exists':
				return m.users_email_exists();
			case 'email_taken':
				return m.users_email_taken();
			case 'self_deactivate':
				return m.users_self_deactivate();
			case 'not_found':
				return m.users_not_found();
			case 'invalid_input':
				return m.users_invalid_input();
			case 'create_failed':
				return m.users_created_failed();
			case 'update_failed':
				return m.users_updated_failed();
			case 'status_failed':
				return m.users_status_failed();
			case 'verify_failed':
				return m.users_verify_failed();
			case 'already_invited':
				return m.users_already_invited();
			case 'invite_failed':
				return m.users_invite_failed();
			default:
				return m.users_created_failed();
		}
	}

	/**
	 * Standard SvelteKit use:enhance handler (#295) — the golden reference for
	 * form mutations: `deserialize` + `applyAction` are handled by `enhance`,
	 * the action result is a typed ActionResult (success/failure/redirect/error)
	 * and no imperative fetch parsing exists anywhere.
	 */
	const submitEnhance: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				feedback = { type: 'success', message: feedbackFor(result.data?.code, false) };
				closeModal();
				// update() applies the response, resets the form and invalidates the
				// page data (standard applyAction behaviour).
				await update({ reset: true });
			} else if (result.type === 'failure') {
				feedback = { type: 'error', message: feedbackFor(result.data?.code, true) };
			} else if (result.type === 'redirect' || result.type === 'error') {
				// SvelteKit handles redirects and errors natively via applyAction.
				await update();
			}
		};
	};
</script>

<svelte:head>
	<title>{m.users_title()}</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
		<h2 class="h2">{m.users_heading()}</h2>
		<div class="flex gap-2">
			<Button data-testid="users-invite" variant="tonal" color="secondary" onclick={openInvite}>
				<EnvelopeSimple size={16} class="mr-1" />
				{m.users_invite_btn()}
			</Button>
			<Button data-testid="users-add" onclick={openCreate}>
				<UserPlus size={16} class="mr-1" />
				{m.users_add()}
			</Button>
		</div>
	</div>

	{#if feedback}
		<Feedback type={feedback.type} message={feedback.message} ondismiss={() => (feedback = null)} />
	{/if}

	<Input placeholder={m.users_search_placeholder()} bind:value={search} />

	<!-- CRUD data table: SvelteForge Table primitive (golden reference) -->
	<Table {columns} rows={filtered} rowKey="id">
		{#snippet children({ row, col })}
			{#if col.key === 'name'}
				<div class="flex items-center gap-3">
					<AvatarInitial name={row.name} size="sm" />
					<div>
						<p class="font-medium">{row.name}</p>
						<p class="text-xs text-surface-700-300 sm:hidden">{row.email}</p>
					</div>
				</div>
			{:else if col.key === 'status'}
				{#if row.disabled}
					<Badge color="warning">{m.users_disabled()}</Badge>
				{:else}
					<!-- toggleVerify is a real form action too (#295): hidden inputs carry
					     the id and the current state, use:enhance handles the result. -->
					<form method="POST" action="?/toggleVerify" use:enhance={submitEnhance}>
						<input type="hidden" name="id" value={row.id} />
						<input type="hidden" name="verified" value={String(row.emailVerified)} />
						<button
							type="submit"
							class="inline-flex"
							aria-label={row.emailVerified ? m.users_pending() : m.users_verified()}
						>
							<Badge color={row.emailVerified ? 'success' : 'warning'}>
								{row.emailVerified ? m.users_verified() : m.users_pending()}
							</Badge>
						</button>
					</form>
				{/if}
			{:else if col.key === 'actions'}
				<div class="flex items-center justify-end gap-1">
					<button
						class="btn preset-tonal-surface p-2"
						data-testid="users-edit"
						onclick={() => openEdit(row)}
						aria-label={m.users_edit()}
					>
						<Pencil size={16} />
					</button>
					<button
						class="btn preset-tonal-warning p-2"
						data-testid="users-status"
						onclick={() => openStatus(row)}
						disabled={row.id === currentUserId}
						aria-label={row.disabled ? m.users_reactivate() : m.users_deactivate()}
					>
						<Power size={16} />
					</button>
				</div>
			{/if}
		{/snippet}
	</Table>

	{#if filtered.length === 0}
		<p class="py-8 text-center text-surface-700-300">{m.users_none()}</p>
	{/if}
</div>

<Dialog
	open={modal !== null}
	closeOnInteractOutside={false}
	restoreFocus={true}
	onOpenChange={(details) => {
		if (!details.open) closeModal();
	}}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card preset-filled-surface-50-950 w-full max-w-md p-4 shadow-xl">
				<div class="mb-4 flex items-center justify-between">
					<Dialog.Title class="h3">
						{modal === 'create'
							? m.users_modal_create()
							: modal === 'edit'
								? m.users_modal_edit()
								: modal === 'invite'
									? m.users_invite_title()
									: statusTarget?.disabled
										? m.users_modal_reactivate()
										: m.users_modal_deactivate()}
					</Dialog.Title>
					<Dialog.CloseTrigger class="btn preset-tonal-surface p-1" aria-label={m.users_close()}>
						<X size={18} />
					</Dialog.CloseTrigger>
				</div>

				{#if modal === 'create' || modal === 'edit'}
					<!-- Real SvelteKit form action (#295): method=POST + action=?/create|?/update,
					     use:enhance handles deserialize/applyAction. No fetch().json() anywhere. -->
					<form
						method="POST"
						action={modal === 'create' ? '?/create' : '?/update'}
						use:enhance={submitEnhance}
						class="space-y-4"
					>
						{#if modal === 'edit' && editUser}
							<input type="hidden" name="id" value={editUser.id} />
						{/if}
						<Input
							label={m.users_label_name()}
							name="name"
							bind:value={formName}
							placeholder={m.users_placeholder_name()}
							required
						/>
						<Input
							label={m.users_label_email()}
							name="email"
							type="email"
							bind:value={formEmail}
							placeholder={m.users_placeholder_email()}
							required
						/>
						{#if modal === 'create'}
							<Input
								label={m.users_label_password()}
								name="password"
								type="password"
								bind:value={formPassword}
								placeholder={m.common_min_chars()}
								required
							/>
						{/if}
						<div class="flex justify-end gap-2 pt-2">
							<Dialog.CloseTrigger type="button" class="btn hover:preset-tonal-surface">{m.common_cancel()}</Dialog.CloseTrigger>
							<Button type="submit">{modal === 'create' ? m.users_create() : m.common_save()}</Button>
						</div>
					</form>
				{:else if modal === 'invite'}
					<Dialog.Description class="mb-4 text-sm text-surface-700-300">{m.users_invite_desc()}</Dialog.Description>
					<form method="POST" action="?/invite" use:enhance={submitEnhance} class="space-y-4">
						<Input
							label={m.users_label_email()}
							name="email"
							type="email"
							bind:value={formEmail}
							placeholder={m.users_placeholder_email()}
							required
						/>
						<div class="flex justify-end gap-2 pt-2">
							<Dialog.CloseTrigger type="button" class="btn hover:preset-tonal-surface">{m.common_cancel()}</Dialog.CloseTrigger>
							<Button type="submit">{m.users_invite_btn()}</Button>
						</div>
					</form>
				{:else if modal === 'status' && statusTarget}
					<Dialog.Description class="mb-4 text-surface-700-300">
						{statusTarget.disabled
							? m.users_reactivate_confirm({ name: statusTarget.name })
							: m.users_deactivate_confirm({ name: statusTarget.name })}
					</Dialog.Description>
					<form method="POST" action="?/toggleStatus" use:enhance={submitEnhance}>
						<input type="hidden" name="id" value={statusTarget.id} />
						<input type="hidden" name="disabled" value={String(!statusTarget.disabled)} />
						<div class="flex justify-end gap-2">
							<Dialog.CloseTrigger type="button" class="btn hover:preset-tonal-surface">{m.common_cancel()}</Dialog.CloseTrigger>
							<Button color={statusTarget.disabled ? 'success' : 'warning'} type="submit"
								>{statusTarget.disabled ? m.users_reactivate_btn() : m.users_deactivate_btn()}</Button
							>
						</div>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
