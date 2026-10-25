---
"svforge": minor
---

Dashboard projects now ship an explicit, safe local-development setup (#589):

- `bash scripts/setup.sh` still prepares only the private `.env` and a strong Better Auth secret by default; `--compose` generates a loopback-only `docker-compose.yml` (PostgreSQL 17, named volume, health check, per-project random password) and starts it, `--init-schema` generates the pending Better Auth schema and runs `db:push` **only** against that verified local Compose database, and `--admin` creates the first administrator from `ADMIN_NAME`/`ADMIN_EMAIL` (generating a password into the ignored `.env` when missing, never printing it; an existing admin is a no-op).
- Generated Dashboards expose `<pm> run dev:setup` and `<pm> run dev:local`; plain `dev` and project creation stay side-effect free, and `svforge create` offers the setup only interactively (headless runs print the exact command instead).
- `setup.sh` reruns preserve secrets, volumes and rows; `.env` stays Git-ignored with mode 600; external `DATABASE_URL` values are never replaced and never receive automatic migrations.
