# @svforge/uploads

## 2.3.0

### Minor Changes

- [#673](https://github.com/lelabdev/svforge/pull/673) [`c093e06`](https://github.com/lelabdev/svforge/commit/c093e068ce763ff17e4651e1b81cf56e3fe26c40) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements.

### Patch Changes

- [#661](https://github.com/lelabdev/svforge/pull/661) [`4cd437c`](https://github.com/lelabdev/svforge/commit/4cd437cc517d3d6e6284a50eb3b5f400244d9f1a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard projects that select the **uploads** module can now opt into local S3-compatible storage through the same `bash scripts/setup.sh --compose` flow ([#610](https://github.com/lelabdev/svforge/issues/610)):
  
  - a digest-pinned `adobe/s3mock` service (loopback-only, persistent `s3-data` volume, health check) joins the managed Compose project; projects without the uploads module never get a storage service or S3 configuration;
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_PORT` are generated once in the Git-ignored `.env` and match the Compose configuration; reruns preserve them;
  - an existing external S3/R2 configuration is preserved and no local S3 service starts;
  - the generated S3 client now honours `S3_FORCE_PATH_STYLE=true` (required by S3Mock and other path-style backends) while keeping the virtual-host default for R2/production S3;
  - generated docs explain host vs container endpoints, S3Mock's development-only scope, and that `docker compose down -v` deletes local objects.
  - adding `uploads` to an existing PostgreSQL-only Dashboard evolves the managed Compose in place: the PostgreSQL service, named volume, port, password and project identity are preserved while the S3 service is appended and started; switching to an external S3/R2 provider (or dropping uploads) is refused with a non-destructive path instead of silently removing the managed S3 service or its data.

- [#677](https://github.com/lelabdev/svforge/pull/677) [`c650710`](https://github.com/lelabdev/svforge/commit/c650710e958659d6c9099eab2362c1cf6cd113ea) Thanks [@LudoLoops](https://github.com/LudoLoops)! - One Vitest authority for every scaffold: the Dashboard no longer declares its own runner (it inherits Base's `^5.0.0`) and its reference manifest mirrors that, while the optional uploads testpack now declares the same version instead of downgrading to Vitest 4. The reusable Docker builder lockfile was regenerated with the documented Bun 1.3.14 procedure and validated by the builder smoke test. The Dashboard PostgreSQL suites (10 files / 46 tests) and the `dashboard-integrations` composition including the uploads security pack (11 files / 53 tests) were run green on Vitest 5 against a real PostgreSQL 17.2. The uploads showcase drop zone also gained an accessible `role="group"`, and every showcase demo page is now guarded against compiler/a11y warnings.

## 2.2.1

### Patch Changes

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style.

## 2.2.0

No changes in this release.

## 2.0.2 — 2026-10-09

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Contribute S3-compatible storage configuration keys to the composed `.env.example` with documented placeholders.

### Deprecations
- None.

## 2.0.1 — 2026-09-12

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.

### Deprecations
- None.
