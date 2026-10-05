// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUploadForm, MAX_FILE_SIZE, MAX_POST_BODY_SIZE } from '$lib/uploads/post-form';

// Mock the S3 client and env so the endpoint logic is testable without AWS.
vi.mock('$lib/server/s3', () => ({
	getS3: () => ({})
}));

const createPresignedPost = vi.fn();
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost }));
const getSignedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));

const env: Record<string, string | undefined> = { S3_BUCKET: 'test-bucket', S3_UPLOAD_SIZE_POLICY: undefined };
vi.mock('$app/env/private', () => env);

// Import the endpoint AFTER mocks are registered.
const { POST } = await import('./+server');

function makeRequest(body: unknown, user: unknown = { id: 'u1' }) {
	return {
		request: { json: () => Promise.resolve(body) },
		locals: { user }
	} as any;
}

/** A small S3-compatible backend that enforces the generated POST policy. */
function policyEnforcingStorage(maxBodySize: number) {
	const objects = new Map<string, number>();
	return {
		objects,
		async post(key: string, form: FormData) {
			const request = new Request('https://storage.example/post', { method: 'POST', body: form });
			const bodySize = (await request.arrayBuffer()).byteLength;
			if (bodySize < 1 || bodySize > maxBodySize) return false;
			objects.set(key, (form.get('file') as Blob).size);
			return true;
		}
	};
}

function postLimit() {
	const options = createPresignedPost.mock.calls.at(-1)?.[1];
	return options.Conditions.find((condition: unknown[]) => condition[0] === 'content-length-range')[2];
}

beforeEach(() => {
	vi.clearAllMocks();
	createPresignedPost.mockResolvedValue({
		url: 'https://signed.example/post',
		fields: { key: 'uploads/signed-key', 'Content-Type': 'image/png' }
	});
	getSignedUrl.mockResolvedValue('https://signed.example/url');
	env.S3_UPLOAD_SIZE_POLICY = undefined;
});

describe('upload endpoint security (test pack)', () => {
	it('requires authentication (401)', async () => {
		let caught: any;
		try {
			await POST(makeRequest({}, null));
		} catch (e) {
			caught = e;
		}
		expect(caught?.status).toBe(401);
	});

	it('rejects invalid MIME types (400)', async () => {
		const res = await POST(makeRequest({ filename: 'x.exe', contentType: 'application/x-msdownload', size: 100 }));
		expect(res.status).toBe(400);
	});

	it('rejects files over the effective file limit (413)', async () => {
		const res = await POST(makeRequest({ filename: 'big.png', contentType: 'image/png', size: MAX_FILE_SIZE + 1 }));
		expect(res.status).toBe(413);
	});

	it('sanitizes filenames in the S3 key', async () => {
		const res = await POST(makeRequest({ filename: '../../evil.png', contentType: 'image/png', size: 100 }));
		const body = await res.json();
		expect(body.key.startsWith('uploads/')).toBe(true);
		expect(body.key.slice('uploads/'.length)).not.toMatch(/\/|\.\./);
	});

	it('rejects a lying declared size with an oversized multipart payload without retaining an object', async () => {
		const presign = await POST(makeRequest({ filename: 'avatar.png', contentType: 'image/png', size: 1 }));
		const upload = await presign.json();
		const storage = policyEnforcingStorage(postLimit());
		const oversized = new Blob([new Uint8Array(MAX_POST_BODY_SIZE)], { type: 'image/png' }) as File;

		expect(await storage.post(upload.key, createUploadForm(upload.fields, oversized))).toBe(false);
		expect(storage.objects.has(upload.key)).toBe(false);
	});

	it('stores an at-limit file because the bounded multipart envelope fits the POST policy', async () => {
		const presign = await POST(makeRequest({ filename: 'avatar.png', contentType: 'image/png', size: MAX_FILE_SIZE }));
		const upload = await presign.json();
		const storage = policyEnforcingStorage(postLimit());
		const atLimit = new Blob([new Uint8Array(MAX_FILE_SIZE)], { type: 'image/png' }) as File;

		expect(await storage.post(upload.key, createUploadForm(upload.fields, atLimit))).toBe(true);
		expect(storage.objects.get(upload.key)).toBe(MAX_FILE_SIZE);
	});

	it('labels the PUT-only provider fallback as explicitly best-effort', async () => {
		env.S3_UPLOAD_SIZE_POLICY = 'presigned-put';
		const res = await POST(makeRequest({ filename: 'avatar.png', contentType: 'image/png', size: 500 }));
		expect(await res.json()).toMatchObject({ method: 'PUT', sizePolicy: 'best-effort' });
		expect(createPresignedPost).not.toHaveBeenCalled();
		expect(getSignedUrl).toHaveBeenCalledOnce();
	});
});
