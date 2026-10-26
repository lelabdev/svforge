---
'svforge': patch
'@svforge/uploads': minor
'@svforge/addon-kit': patch
---

`@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements.
