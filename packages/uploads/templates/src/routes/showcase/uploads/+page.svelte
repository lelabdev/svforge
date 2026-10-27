<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { Card } from '#lib/components/svforge/ui/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';
	import {
		ALLOWED_MIME_TYPES,
		MAX_FILE_SIZE,
		validateUploadFile
	} from '#lib/uploads/policy.js';

	/**
	 * Uploads showcase (#586, phase 5).
	 *
	 * SAFE BY DEFAULT: this page never touches `/api/upload`, S3/R2, the network
	 * or storage. It validates the selection with the module's own shared policy
	 * and simulates the progress/success states, so the flow can be inspected
	 * without credentials. The real `FileUpload.svelte` component is the one that
	 * posts to the authenticated endpoint — see the note at the bottom.
	 */
	type Status = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

	let status = $state<Status>('idle');
	let progress = $state(0);
	let fileName = $state('');
	let fileSize = $state(0);
	let errorMessage = $state('');
	let simulatedKey = $state('');
	let input: HTMLInputElement | undefined = $state();
	let run = 0;

	const maxSizeLabel = `${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB`;

	function formatSize(bytes: number): string {
		return bytes >= 1024 * 1024
			? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	function messageFor(code: 'file_type_not_allowed' | 'file_too_large' | 'invalid_size'): string {
		switch (code) {
			case 'file_type_not_allowed':
				return m.uploads_error_invalid_file_type();
			case 'file_too_large':
				return m.uploads_error_file_too_large();
			default:
				return m.uploads_error_invalid_request();
		}
	}

	async function simulate(file: File) {
		const token = ++run;
		fileName = file.name;
		fileSize = file.size;
		simulatedKey = '';
		progress = 0;

		const rejection = validateUploadFile({ name: file.name, type: file.type, size: file.size });
		if (rejection) {
			status = 'error';
			errorMessage = messageFor(rejection);
			return;
		}

		status = 'uploading';
		for (const step of [0, 35, 70, 100]) {
			if (token !== run) return;
			await new Promise((resolve) => setTimeout(resolve, 180));
			if (token !== run) return;
			progress = step;
		}
		status = 'success';
		// Illustrative only: the real endpoint returns `uploads/<uuid>-<name>`.
		simulatedKey = `uploads/demo-${file.name}`;
	}

	function onSelect(event: Event) {
		const selected = (event.target as HTMLInputElement).files?.[0];
		if (selected) void simulate(selected);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		const dropped = event.dataTransfer?.files?.[0];
		if (dropped) void simulate(dropped);
	}

	function reset() {
		run += 1;
		status = 'idle';
		progress = 0;
		fileName = '';
		fileSize = 0;
		errorMessage = '';
		simulatedKey = '';
		if (input) input.value = '';
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.showcase_uploads_title()}</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<header class="space-y-2">
		<h1 class="h1">{m.showcase_uploads_title()}</h1>
		<p class="text-surface-700-300">{m.showcase_uploads_description()}</p>
	</header>

	<Card>
		<p class="mb-4 text-sm text-surface-700-300">{m.showcase_uploads_hint()}</p>

		<!-- The drop target is a supplementary surface: the file input below is the
		     accessible control, so the zone is a labelled group rather than a
		     keyboard-interactive element of its own. -->
		<div
			role="group"
			aria-label={m.showcase_uploads_choose()}
			class="rounded-container border border-dashed border-surface-300-700 p-6 text-center"
			ondragover={(event) => event.preventDefault()}
			ondrop={onDrop}
		>
			<label class="flex flex-col items-center gap-3 text-sm">
				<span class="font-medium">{m.showcase_uploads_choose()}</span>
				<input
					bind:this={input}
					type="file"
					accept={ALLOWED_MIME_TYPES.join(',')}
					class="cursor-pointer text-sm"
					onchange={onSelect}
					aria-label={m.showcase_uploads_choose()}
				/>
			</label>
			<p class="mt-2 text-xs text-surface-700-300">
				{m.showcase_uploads_limits({ size: maxSizeLabel })}
			</p>
		</div>

		<div class="mt-4 space-y-3" aria-live="polite">
			{#if status === 'uploading'}
				{@const percent = `${progress}%`}
				<Progress value={progress} class="grid grid-cols-[auto_1fr] items-center gap-4">
					<Progress.Label class="text-sm">{percent}</Progress.Label>
					<Progress.Track>
						<Progress.Range />
					</Progress.Track>
				</Progress>
				<p class="text-sm">{m.uploads_uploading()}</p>
			{:else if status === 'success'}
				<p class="text-sm">
					<span class="font-semibold">{m.showcase_uploads_success()}</span>
					— {fileName} ({formatSize(fileSize)})
				</p>
				<p class="text-xs text-surface-700-300">
					{m.showcase_uploads_simulated()} <code class="text-primary-900-100">{simulatedKey}</code>
				</p>
			{:else if status === 'error'}
				<p class="text-sm text-error-700-300" role="alert">{errorMessage}</p>
			{/if}
		</div>

		<div class="mt-4 flex justify-end">
			<Button type="button" variant="tonal" color="surface" disabled={status === 'idle'} onclick={reset}>
				{m.showcase_uploads_reset()}
			</Button>
		</div>
	</Card>

	<p class="text-sm text-surface-700-300">{m.showcase_uploads_real_component()}</p>
	<p class="text-sm text-surface-700-300">{m.showcase_uploads_fixture()}</p>
</main>
