# @svforge/uploads

SVForge Uploads — authenticated file uploads to S3-compatible storage.

## Install

```bash
npx sv add @svforge/uploads
```

## What it does

- Adds an S3 client and authenticated `/api/upload` signing endpoint
- Adds a `FileUpload` component with direct-to-storage uploads
- Uses a presigned **POST** policy with `content-length-range` by default

## Environment Variables

The add-on appends these documented placeholders to the root `.env.example`; copy them into `.env` without overwriting existing settings, then replace the placeholders with your storage provider values.

```env
S3_ENDPOINT=https://your-s3-or-r2-endpoint
S3_REGION=auto
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
# Default: presigned-post. Use presigned-put only when POST policies are unsupported.
S3_UPLOAD_SIZE_POLICY=presigned-post
```

## Size policies

`presigned-post` is the default **storage-enforced** policy. It requires an
S3-compatible backend that supports presigned POST policies and enforces a
10 MiB `content-length-range` on the complete multipart request before an
object is stored. Multipart fields and boundaries are part of that request, so
`FileUpload` reserves a bounded 64 KiB envelope: the largest accepted file is
10,420,224 bytes (9.94 MiB), not 10 MiB. A client cannot bypass the 10 MiB
storage request limit by lying about its declared size.

Set `S3_UPLOAD_SIZE_POLICY=presigned-put` only when the backend does not
support POST policies. This fallback validates the declared size before signing
but is explicitly **best-effort**: a holder of the PUT URL may upload a larger
object. Do not use it where a hard storage limit is required; use a provider
with POST policies or add a size-limited server proxy/post-upload verification.

AWS S3 supports the default. Verify POST-policy support with any other
S3-compatible backend before selecting it.

## Deployment profile

Supported: `long-lived-node`, `serverless`. Unsupported: `edge`, `separate-worker`.

A signed PUT does **not** reliably enforce `ContentLength` at the storage layer. For a hard size limit, use a bucket POST policy when supported, reserve/check a per-user quota before signing, and invoke a scan callback before making the object available.

## Usage

```svelte
<script>
	import FileUpload from '$lib/components/svforge/uploads/FileUpload.svelte';
</script>

<FileUpload onUpload={(key) => console.log('Uploaded:', key)} />
```

The callback receives the persistent object key, never an expiring URL.

## License

MIT
