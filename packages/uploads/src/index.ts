import { defineAddon, defineAddonOptions } from 'sv';
import {
	checkModuleCapabilities,
	mergeEnvExample,
	mergeSvelteKitEnvVars,
	planCatalogMerges,
	planAddonContext
} from '@svforge/addon-kit';
import { files } from './templates';

const ENV_EXAMPLE = {
	S3_ENDPOINT: { description: 'S3-compatible storage endpoint', placeholder: 'https://your-s3-compatible-endpoint' },
	S3_REGION: { description: 'S3-compatible storage region', placeholder: 'your_s3_region' },
	S3_BUCKET: { description: 'S3-compatible storage bucket', placeholder: 'your_bucket_name' },
	S3_ACCESS_KEY_ID: { description: 'S3 access key ID', placeholder: 'your_access_key_id' },
	S3_SECRET_ACCESS_KEY: { description: 'S3 secret access key', placeholder: 'replace_with_s3_secret_access_key' },
	S3_FORCE_PATH_STYLE: {
		description: 'Set to true for path-style local backends (S3Mock); leave blank for R2/production S3',
		placeholder: ''
	},
	S3_UPLOAD_SIZE_POLICY: {
		description: 'Optional: leave blank for storage-enforced POST; use presigned-put only for best-effort fallback',
		placeholder: ''
	}
};
const ENV_DECLARATIONS = Object.fromEntries(
	Object.entries(ENV_EXAMPLE).map(([name, entry]) => [name, entry.description])
);

export default defineAddon({
	id: 'svforge-uploads',
	alias: 'forge-uploads',
	shortDescription: 'SVForge Uploads — file uploads to S3/R2',
	homepage: 'https://github.com/lelabdev/svforge',
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
					showcase_uploads_title: 'Téléversements de fichiers',
					showcase_uploads_description: 'Essayez localement la politique de téléversement installée et ses états de progression — sans identifiants ni stockage.',
					showcase_uploads_hint: 'Choisissez un fichier ou déposez-le dans la zone ci-dessous. La sélection est validée par la même politique que celle utilisée par le point de terminaison.',
					showcase_uploads_choose: 'Choisissez un fichier ou déposez-le ici',
					showcase_uploads_limits: 'Autorisés : JPEG, PNG, GIF, WebP, PDF, texte brut, JSON — jusqu’à {size}.',
					showcase_uploads_success: 'Sélection acceptée',
					showcase_uploads_simulated: 'Clé simulée (rien n’a été téléversé) :',
					showcase_uploads_reset: 'Recommencer',
					showcase_uploads_real_component: 'Dans un projet Dashboard, le composant FileUpload.svelte envoie le fichier au point de terminaison authentifié /api/upload et stocke l’objet dans S3/R2 — cette page ne le fait jamais.',
					showcase_uploads_fixture: 'Simulation locale uniquement : aucune requête, aucune persistance.',
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
					showcase_uploads_title: 'File uploads',
					showcase_uploads_description: 'Try the installed upload policy and its progress states locally — no credentials, no storage.',
					showcase_uploads_hint: 'Pick a file or drop it in the area below. The selection is validated by the same policy the endpoint uses.',
					showcase_uploads_choose: 'Choose a file or drop it here',
					showcase_uploads_limits: 'Allowed: JPEG, PNG, GIF, WebP, PDF, plain text, JSON — up to {size}.',
					showcase_uploads_success: 'Selection accepted',
					showcase_uploads_simulated: 'Simulated key (nothing was uploaded):',
					showcase_uploads_reset: 'Start over',
					showcase_uploads_real_component: 'In a Dashboard project, FileUpload.svelte posts to the authenticated /api/upload endpoint and stores the object in S3/R2 — this page never does.',
					showcase_uploads_fixture: 'Local simulation only: no request, no persistence.',
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
		sv.file('src/env.ts', (content) => mergeSvelteKitEnvVars(content, ENV_DECLARATIONS));
		sv.file('.env.example', (content) => mergeEnvExample(content, 'uploads', ENV_EXAMPLE));

		for (const write of [...catalogs.writes, ...context.writes]) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: ({ cwd, options }) => {
		const steps = [
			'@svforge/uploads installed!',
			'Copy the S3/R2 placeholders from .env.example into .env and replace them with your provider values',
			'Upload size policy: POST is storage-enforced by default (requires provider POST policies). Set S3_UPLOAD_SIZE_POLICY=presigned-put only as an explicitly best-effort fallback.',
			'Dashboard local development: `bash scripts/setup.sh --compose` provisions a local S3Mock and the matching S3_* values when no external S3/R2 endpoint is configured (S3Mock is not a production S3/R2 emulation).',
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
