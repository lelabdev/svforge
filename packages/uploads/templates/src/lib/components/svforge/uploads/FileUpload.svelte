<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { createUploadForm } from '$lib/uploads/post-form';

	/** Marker for the only user-safe error surface: a recognized API error payload. */
	class UploadError extends Error {}

	/**
	 * Called once the file has been uploaded to S3/R2, with the PERSISTENT
	 * object key (`uploads/<uuid>-<name>`).
	 *
	 * The presigned URL itself expires after 60s and must not be stored or
	 * treated as a stable reference — `key` is the canonical identifier the
	 * consumer project should persist (e.g. in a DB row).
	 */
	let { onUpload }: { onUpload?: (key: string) => void } = $props();

	let uploading = $state(false);
	let error = $state('');

	async function handleFile(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		const file = input.files[0];

		uploading = true;
		error = '';

		try {
			// 1. Request a presigned PUT URL with the FULL contract of the
			// /api/upload endpoint: filename, contentType AND size. A request
			// without a valid size is rejected with 400 (regression #279).
			const res = await fetch('/api/upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: file.name,
					contentType: file.type,
					size: file.size
				})
			});

			// 2. Check the response BEFORE parsing: a 4xx body is an error
			// payload ({ error: { code } }), not a presign response ({ url, key }).
			if (!res.ok) {
				let message = m.uploads_failed();
				try {
					const code = (await res.json())?.error?.code;
					// Privacy: only the KNOWN validation codes of our own endpoint are
					// surfaced — always through localized copy, never a raw server
					// string (a 5xx body may carry provider error details).
					switch (code) {
						case 'file_type_not_allowed':
							message = m.uploads_error_invalid_file_type();
							break;
						case 'file_too_large':
							message = m.uploads_error_file_too_large();
							break;
						case 'invalid_json':
						case 'filename_required':
						case 'content_type_required':
						case 'invalid_size':
							message = m.uploads_error_invalid_request();
							break;
						// Unknown codes (e.g. a 500 'internal') keep the generic fallback.
					}
				} catch {
					// keep the generic message when the body is not JSON
				}
				throw new UploadError(message);
			}

			const upload = await res.json();
			const { url, key } = upload;

			// 3. POST policies carry a storage-enforced content-length-range.
			// PUT is the documented best-effort fallback for providers lacking it.
			const uploadRes =
				upload.method === 'POST'
					? await fetch(url, {
							method: 'POST',
							body: createUploadForm(upload.fields, file)
						})
					: await fetch(url, {
							method: 'PUT',
							body: file,
							headers: { 'Content-Type': file.type }
						});
			if (!uploadRes.ok) throw new Error(m.uploads_failed());

			// 4. Deliver the persistent key — never the expiring URL.
			onUpload?.(key);
		} catch (err: unknown) {
			console.error('FileUpload failed:', err);
			error = err instanceof UploadError ? err.message : m.uploads_failed();
		} finally {
			uploading = false;
		}
	}
</script>

<div>
	<input type="file" onchange={handleFile} disabled={uploading} />
	{#if uploading}<span>{m.uploads_uploading()}</span>{/if}
	{#if error}<p class="text-error-700-300 mt-1 text-sm" role="alert">{error}</p>{/if}
</div>
