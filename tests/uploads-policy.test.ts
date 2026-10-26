import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ALLOWED_MIME_TYPES,
	MAX_FILE_SIZE,
	validateUploadFile
} from '../packages/uploads/templates/src/lib/uploads/policy';
import { ROOT } from './helpers';

/**
 * #586 — the upload policy is shared by the endpoint and the showcase demo.
 *
 * These are behaviour tests of the real contract: the codes returned here are
 * exactly the `error.code` payloads the endpoint sends, so a client pre-check
 * can never disagree with the server on what is acceptable.
 */
describe('shared upload policy (#586)', () => {
	it('accepts an allowed type at the size limit', () => {
		expect(validateUploadFile({ name: 'photo.png', type: 'image/png', size: MAX_FILE_SIZE })).toBeNull();
	});

	it('rejects a disallowed type with the endpoint code (SVG stays excluded)', () => {
		expect(ALLOWED_MIME_TYPES).not.toContain('image/svg+xml');
		expect(validateUploadFile({ name: 'x.svg', type: 'image/svg+xml', size: 10 })).toBe('file_type_not_allowed');
		expect(validateUploadFile({ name: 'x.exe', type: 'application/x-msdownload', size: 10 })).toBe(
			'file_type_not_allowed'
		);
	});

	it('rejects an oversized file with the endpoint code', () => {
		expect(validateUploadFile({ name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_SIZE + 1 })).toBe(
			'file_too_large'
		);
	});

	it('rejects empty or non-finite sizes', () => {
		expect(validateUploadFile({ name: 'empty.txt', type: 'text/plain', size: 0 })).toBe('invalid_size');
		expect(validateUploadFile({ name: 'nan.txt', type: 'text/plain', size: Number.NaN })).toBe('invalid_size');
		expect(validateUploadFile({ name: 'inf.txt', type: 'text/plain', size: Number.POSITIVE_INFINITY })).toBe(
			'invalid_size'
		);
	});

	it('is the single source the endpoint validates with', () => {
		const server = readFileSync(
			join(ROOT, 'packages/uploads/templates/src/routes/api/upload/+server.ts'),
			'utf-8'
		);
		// The allowlist cannot drift back into the endpoint, and the stable codes
		// keep their HTTP semantics (400 for type/size, 413 for too large).
		expect(server).toContain("from '#lib/uploads/policy.js'");
		expect(server).not.toContain("'image/jpeg'");
		expect(server).toMatch(/rejection === 'file_type_not_allowed' \|\| rejection === 'invalid_size'[\s\S]*?status: 400/);
		expect(server).toMatch(/rejection === 'file_too_large'[\s\S]*?status: 413/);
	});
});
