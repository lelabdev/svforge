import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, mergeSvelteKitEnvVars, planCatalogMerges, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';

export default defineAddon({
	id: 'svforge-uploads',
	alias: 'forge-uploads',
	shortDescription: 'SVForge Uploads — file uploads to S3/R2',
	homepage: 'https://github.com/lelabdev/svelteforge',
	options: defineAddonOptions()
		.add('testpack', {
			question: 'Install the upload security test pack? (vitest, regression guards for the endpoint)',
			type: 'boolean',
			default: false
		})
		.build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Uploads requires SvelteKit');
	},

	run: ({ sv, cancel, cwd, options }) => {
		// Capability gate (#323): the upload endpoint enforces identity via
		// locals.user, the components use Paraglide copy, and the module
		// PROVIDES storage.object for other modules.
		const gate = checkModuleCapabilities(cwd, 'uploads');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}
		// Capability warnings (#323): unverifiable or unverified requirements are
		// emitted as diagnostics — the install proceeds, support is never pretended.
		for (const warning of gate.warnings) console.warn(`[svforge] ${warning}`);


		sv.dependency('@aws-sdk/client-s3', '^3.1111.0');
		sv.dependency('@aws-sdk/s3-presigned-post', '^3.1111.0');
		sv.dependency('@aws-sdk/s3-request-presigner', '^3.1111.0');

		// Paraglide messages (#239) + manifest (#234): PLANNED in memory before
		// any write (#324) — one invalid catalog or manifest cancels the whole
		// install and every file stays byte-for-byte identical.
		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/fr.json',
				additions: {
					uploads_uploading: 'Téléversement…',
					uploads_failed: 'Échec du téléversement',
					uploads_error_invalid_file_type: 'Type de fichier non autorisé',
					uploads_error_file_too_large: 'Fichier trop volumineux',
					uploads_error_invalid_request: 'Requête de téléversement invalide'
				}
			},
			{
				path: 'messages/en.json',
				additions: {
					uploads_uploading: 'Uploading…',
					uploads_failed: 'Upload failed',
					uploads_error_invalid_file_type: 'File type not allowed',
					uploads_error_file_too_large: 'File too large',
					uploads_error_invalid_request: 'Invalid upload request'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		const context = planAddonContext(cwd, { moduleId: 'uploads', capability: 'uploads (S3-compatible: POST hard limit, PUT best-effort fallback)', pattern: 'src/routes/api/upload/+server.ts (S3_UPLOAD_SIZE_POLICY)' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}

		// Test pack needs vitest + a test script in the target project (#182)
		if (options.testpack) {
			sv.devDependency('vitest', '^4.1.5');
			sv.devDependency('jsdom', '^29.1.1');
			sv.file('package.json', (content) => {
				if (!content) return content;
				// #331: JSON transformation, not a string includes — any package
				// containing the substring `"test"` (a dep name, a keyword) used
				// to make this patch silently skip.
				const pkg = JSON.parse(content);
				if (pkg.scripts?.test) return content;
				pkg.scripts = { ...(pkg.scripts || {}), test: 'vitest run' };
				return `${JSON.stringify(pkg, null, 2)}\n`;
			});
		}

		for (const [path, content] of Object.entries(files)) {
			// The security test pack is opt-in (#182): only write it when selected.
			if (path === '/routes/api/upload/upload-security.test.ts' && !options.testpack) continue;
			sv.file(`src${path}`, () => content);
		}
		sv.file('src/env.ts', (content) =>
			mergeSvelteKitEnvVars(content, {
				S3_ENDPOINT: 'S3-compatible storage endpoint',
				S3_REGION: 'S3-compatible storage region',
				S3_BUCKET: 'S3-compatible storage bucket',
				S3_ACCESS_KEY_ID: 'S3 access key ID',
				S3_SECRET_ACCESS_KEY: 'S3 secret access key',
				S3_UPLOAD_SIZE_POLICY: 'Optional upload size policy'
			})
		);

		for (const write of [...catalogs.writes, ...context.writes]) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd, options }) => {
		const steps = [
			'@svforge/uploads installed!',
			'Add S3/R2 credentials to .env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
			'Upload size policy: POST is storage-enforced by default (requires provider POST policies). Set S3_UPLOAD_SIZE_POLICY=presigned-put only as an explicitly best-effort fallback.',
			'Usage: <FileUpload onUpload={(key) => console.log(key)} /> — key is the persistent object key, not the expiring presigned URL',
			...(options.testpack
				? ['Test pack installed: bun run test (upload endpoint security)']
				: [])
		];
		// Unverified capabilities (#323): on a non-SVForge project whose auth
		// wiring could not be confirmed structurally, install proceeds WITH a
		// clear warning instead of silently pretending support.
		if (typeof cwd === 'string') {
			const gate = checkModuleCapabilities(cwd, 'uploads');
			if (gate.ok) steps.push(...gate.warnings);
		}
		return steps;
	}
});
