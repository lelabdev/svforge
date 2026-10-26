import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3 } from '#lib/server/s3.js';
import { MAX_POST_BODY_SIZE } from '#lib/uploads/post-form.js';
import { validateUploadFile } from '#lib/uploads/policy.js';
import * as env from '$app/env/private';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The S3 POST policy applies to the complete multipart request. FileUpload
 * reserves a bounded 64 KiB envelope, so this is the largest file that its
 * at-limit multipart form can submit under the 10 MiB request policy.
 */

/**
 * Upload policy selected by the deployment.
 *
 * `presigned-post` is the default hard-limit mode. S3-compatible providers
 * that implement POST policies enforce content-length-range before storing an
 * object. Set S3_UPLOAD_SIZE_POLICY=presigned-put only for providers without
 * POST-policy support: it validates the declared size before signing, but is
 * explicitly best-effort because a holder of the PUT URL can upload more.
 */
function getSizePolicy(): 'best-effort' | 'storage-enforced' {
	return env.S3_UPLOAD_SIZE_POLICY === 'presigned-put' ? 'best-effort' : 'storage-enforced';
}

function sanitizeFilename(name: string): string {
	const cleaned = name.replace(/[/\\]/g, '').replace(/\.\.+/g, '.');
	const trimmed = cleaned.trim().replace(/\s+/g, '-').slice(0, 100);
	return trimmed || 'file';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, { message: 'Authentication required' });

	// Error contract: stable machine codes under `error.code` — never raw
	// provider/server strings. FileUpload maps ONLY these known codes to
	// localized copy; any other payload keeps the client-side generic fallback.
	let filename: string;
	let contentType: string;
	let size: number;
	try {
		const body = await request.json();
		filename = body.filename;
		contentType = body.contentType;
		size = body.size;
	} catch {
		return json({ error: { code: 'invalid_json' } }, { status: 400 });
	}

	if (!filename || typeof filename !== 'string') return json({ error: { code: 'filename_required' } }, { status: 400 });
	if (!contentType || typeof contentType !== 'string') return json({ error: { code: 'content_type_required' } }, { status: 400 });
	// Type + size are validated by the SHARED policy (#586): the client-side
	// pre-check used by the showcase demo answers with these exact codes.
	const rejection = validateUploadFile({ name: filename, type: contentType, size });
	if (rejection === 'file_type_not_allowed' || rejection === 'invalid_size') {
		return json({ error: { code: rejection } }, { status: 400 });
	}
	if (rejection === 'file_too_large') {
		return json({ error: { code: rejection } }, { status: 413 });
	}

	const key = `uploads/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
	const sizePolicy = getSizePolicy();
	if (sizePolicy === 'storage-enforced') {
		const post = await createPresignedPost(getS3(), {
			Bucket: env.S3_BUCKET!,
			Key: key,
			Fields: { 'Content-Type': contentType },
			Conditions: [
				['content-length-range', 1, MAX_POST_BODY_SIZE],
				['eq', '$Content-Type', contentType]
			],
			Expires: 60
		});
		return json({ method: 'POST', ...post, key, sizePolicy });
	}

	// Fallback only: ContentLength is signed but does not constrain the object
	// S3 stores. Do not represent this declared-size validation as a hard limit.
	const url = await getSignedUrl(
		getS3(),
		new PutObjectCommand({ Bucket: env.S3_BUCKET!, Key: key, ContentType: contentType, ContentLength: size }),
		{ expiresIn: 60 }
	);
	return json({ method: 'PUT', url, key, sizePolicy });
};
