import { S3Client } from '@aws-sdk/client-s3';
import * as env from '$app/env/private';

/**
 * Create the S3 client lazily, on first use (#237).
 *
 * The module is evaluated by SvelteKit's postbuild analysis at `vite build`
 * time — a `throw` at the top level breaks any project that scaffolds this
 * addon before configuring S3 env vars. Env vars are read at call time, so a
 * fresh scaffold builds fine and fails only at runtime if S3 is actually used
 * without credentials.
 */
let cached: S3Client | undefined;

export function getS3(): S3Client {
	if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
		throw new Error('S3 credentials are not set (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
	}
	return (cached ??= new S3Client({
		region: env.S3_REGION ?? 'auto',
		endpoint: env.S3_ENDPOINT,
		// All three credentials are checked above, so secretAccessKey is a
		// string here — the guard also satisfies the AWS SDK types (#284).
		credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
	}));
}
