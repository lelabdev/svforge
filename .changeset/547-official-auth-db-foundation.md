---
"svforge": minor
---

New Dashboard projects now use the official `sv add drizzle better-auth` integrations for the auth/DB foundation instead of SVForge-generated copies: the official add-ons run first in `svforge create`, and SVForge only extends their output (sign-up policy, `role`/`disabled` via Better Auth `additionalFields`, one composed disabled-identity guard, domain tables). `auth:schema` is now the official generator (configure `DATABASE_URL`, then run `auth:schema` and `db:push` before the first check), the legacy Better Auth pin/tooling and review-copy workflow are removed, and the security audit resolves the range declared by the installed `sv`. Base projects are unchanged; existing projects are not migrated.
