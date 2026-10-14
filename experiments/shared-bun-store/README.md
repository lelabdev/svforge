# Shared Bun store across Docker containers (proof of concept)

This experiment validates **one physical Bun global virtual store** for independent
applications, without publishing or maintaining a giant SVForge base image.

Requires Docker Compose and **Bun >= 1.3.14** (the global virtual store does not
exist in Bun 1.3.13). The experiment pins `oven/bun:1.3.14`. Do not change
the version in only one service.

## How it works

- `shared-store`: writable by the **installers**, read-only in **runtime** services.
  `BUN_INSTALL_CACHE_DIR=/bun-store` and `BUN_INSTALL_GLOBAL_STORE=1`.
- `modules-a` and `modules-b`: per-application symlink trees, **not** a
  shared writable `node_modules`.
- `bun install --linker isolated --production --frozen-lockfile --ignore-scripts`
  creates links to `/bun-store/links`. A shared package (same version and
  resolved dependency closure) points to the same physical store entry.
- App A additionally uses `nanoid`; App B uses `date-fns`. Common packages:
  `zod`, `clsx`, `tailwind-merge`.
- No host ports are exposed.

Run the automated, self-cleaning smoke test (its **own** project/volumes):

```sh
bash experiments/shared-bun-store/smoke.sh
```

Or run the example manually from this directory:

```sh
docker compose run --rm --no-deps install-a
docker compose run --rm --no-deps install-b
docker compose up -d --no-deps app-a app-b
docker compose exec -T app-a readlink -f /app/node_modules/zod
docker compose exec -T app-b readlink -f /app/node_modules/zod
docker compose exec -T app-a du -sh /app/node_modules /bun-store
```

The two `readlink` commands must resolve to exactly the same path under
`/bun-store/links`. Installers rerun on dependency upgrades; apps can continue
using their existing node_modules volumes until the new versions are ready.

**Be careful:** `docker compose down -v` deletes the common package store
and both local module volumes. Never use it on a real production deployment.
This smoke test uses a uniquely named disposable project to ensure it cannot
delete any existing deployment's volumes.

## Applying the architecture to SVForge apps

1. Keep a **multistage Dockerfile** for building a SvelteKit app with its
   normal full development dependencies. Copy only the compiled `build/`,
   manifests, and required static/migration assets into the runtime image;
   **do not bake a separate production node_modules tree into each image**.
2. Give each app an isolated, persistent `node_modules` volume and use an
   installer/init job that mounts the **same** common store read-write, plus
   its own `node_modules` read-write, with a pinned `bun.lock`.
3. Run the installer after any dependency/lockfile update, **before switching
   the app to the new image**. Keep the runtime's store mount read-only at
   the same path (`/bun-store`) so absolute symlinks resolve. Deploy apps
   independently and ensure their build/runtime Bun versions are compatible.
4. Test actual SvelteKit adapter-node runtime, migrations (including any
   migration CLI needed at runtime), native packages, file permissions,
   simultaneous installers, and failure recovery before converting production.
5. Back up the original lockfiles/manifests and keep rollback plans; do not
   routinely prune the shared store while dependent apps are running.

Limitations: packages using patch/trusted scripts or local workspace/file/link
dependencies can remain in project-local directories; different transitive
resolutions can produce separate store entries. Read-only app containers need
only read the store, but installing native dependencies may require build scripts.
The sample uses read/write source bind mounts **only for this sandbox**;
production services should bake compiled output into their own immutable images
and drop permissions.

## Baseline from Atlas (2026-10-14)

With Bun 1.3.14 and the two small fixtures:
- Shared `/bun-store`: **48 MiB** (Bun download cache **plus** global links).
- `/app/node_modules`: **16 KiB** for A, **12 KiB** for B (symlinks).
- Both app HTTP smoke tests passed and `zod@4.3.5` resolved to the
  **same global directory**.

These figures demonstrate physical sharing; they **do not** estimate the net
saving for real SVForge services, whose lockfiles and native dependencies
are different. Compare actual host disk use and run real project-specific
smokes before claiming production savings.
