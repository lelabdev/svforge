---
"svforge": minor
---

Dashboard projects now ship an explicit, safe local-development setup (#589):

- `bash scripts/setup.sh` still prepares only the private `.env` and a strong Better Auth secret by default; `--compose` generates a loopback-only `docker-compose.yml` (PostgreSQL 17, named volume, health check, per-project random password) and starts it, `--init-schema` generates the pending Better Auth schema and runs `db:push` **only** against that verified local Compose database, and `--admin` creates the first administrator from `ADMIN_NAME`/`ADMIN_EMAIL` (generating a password into the ignored `.env` when missing, never printing it; an existing admin is a no-op).
- Generated Dashboards expose `<pm> run dev:setup` and `<pm> run dev:local`; plain `dev` and project creation stay side-effect free, and `svforge create` offers the setup only interactively (headless runs print the exact command instead).
- Existing `docker-compose.yml` files are reused only when they carry the SVForge ownership marker and match the managed service exactly; anything else is refused before credentials are written or Compose runs. Schema initialization validates the effective Compose model (parsed by Compose, including interpolation), refuses override files and ambient `COMPOSE_*` controls, verifies the exact URL credentials/port, the running service's published port and its database identity, and runs `auth:schema`/`db:push`/`admin:create` with a sanitized environment so an exported `DATABASE_URL` can never redirect them away from the verified local `.env` connection. and `--admin` relies on a dedicated exit code (3 = already exists) instead of message text.
- `setup.sh` reruns preserve secrets, volumes and rows; `.env` stays Git-ignored with mode 600; external `DATABASE_URL` values are never replaced and never receive automatic migrations.
