---
"svforge": minor
"@svforge/uploads": patch
---

Dashboard projects that select the **uploads** module can now opt into local S3-compatible storage through the same `bash scripts/setup.sh --compose` flow (#610):

- a digest-pinned `adobe/s3mock` service (loopback-only, persistent `s3-data` volume, health check) joins the managed Compose project; projects without the uploads module never get a storage service or S3 configuration;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_PORT` are generated once in the Git-ignored `.env` and match the Compose configuration; reruns preserve them;
- an existing external S3/R2 configuration is preserved and no local S3 service starts;
- the generated S3 client now honours `S3_FORCE_PATH_STYLE=true` (required by S3Mock and other path-style backends) while keeping the virtual-host default for R2/production S3;
- generated docs explain host vs container endpoints, S3Mock's development-only scope, and that `docker compose down -v` deletes local objects.
