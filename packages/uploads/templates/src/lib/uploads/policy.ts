/**
 * Upload policy shared by the endpoint and any client-side pre-check (#586).
 *
 * The server is authoritative: this module only answers "would the endpoint
 * accept this file?" with the SAME codes and limits, so the showcase demo and
 * the real component cannot drift. It must stay isomorphic — no server-only or
 * environment imports.
 */
import { MAX_FILE_SIZE } from './post-form.js';

/**
 * Allowed MIME types for uploads. SVG is deliberately EXCLUDED: serving an
 * untrusted SVG from the app origin can result in stored XSS.
 */
export const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'application/pdf',
	'text/plain',
	'application/json'
] as const;

/** Largest file the endpoint accepts (see post-form.ts for the POST envelope). */
export { MAX_FILE_SIZE };

/** Stable rejection codes — identical to the endpoint's `error.code` payload. */
export type UploadRejectionCode = 'file_type_not_allowed' | 'file_too_large' | 'invalid_size';

export interface UploadCandidate {
	name: string;
	type: string;
	size: number;
}

/**
 * `null` when the endpoint would accept the file, otherwise the code it would
 * return. Field-presence errors (`filename_required`, `content_type_required`)
 * stay server-side: they describe a broken request, not a user's file.
 */
export function validateUploadFile(candidate: UploadCandidate): UploadRejectionCode | null {
	if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(candidate.type)) {
		return 'file_type_not_allowed';
	}
	if (!Number.isFinite(candidate.size) || candidate.size <= 0) {
		return 'invalid_size';
	}
	if (candidate.size > MAX_FILE_SIZE) {
		return 'file_too_large';
	}
	return null;
}
