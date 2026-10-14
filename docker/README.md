# SVForge reusable Docker builder

Build a **versioned build image** from the existing SVForge Dashboard package
manifest. It preinstalls the common stack (Svelte/Vite/Skeleton/Auth/Drizzle,
etc.) and caches resolved packages in a common Docker image layer.
There is **no manually maintained second package list**.

The image is optional: SVForge consumers are free to use any deployment setup.
It does not change scaffold behavior and is never required at runtime.

## Build

From the repository root:

```sh
docker build -f docker/builder.Dockerfile -t svforge-builder:local .
```

Use a versioned, immutable tag or digest if publishing this build image for
multiple projects. Do not automatically replace existing pinned images.

## From an independent application

In the application's **build stage**, use this image, then install from that
application's own lockfile:

```dockerfile
FROM svforge-builder:local AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
```

Follow it with a **separate runtime stage** based on an appropriate Bun/Node
image, copying only compiled output, production dependencies and required
runtime assets. The runtime stage **does not inherit** the builder image and
does not mount a shared dependency volume. Migration tools must be handled
explicitly if used at startup (e.g. Denden's `drizzle-kit`).

The builder has `BUN_INSTALL_CACHE_DIR=/bun-cache`, inherited by the build
stage. Packages matching the preinstalled versions can be reused instead of
downloaded. If the app has a different `bun.lock`, Bun still resolves and
installs the versions that **that application** needs, potentially creating
additional copies in its own build layer. Shared Docker layers do not magically
deduplicate different package versions or final production images.

## Update the stack

The **source of truth** is
`packages/svforge/templates/dashboard/package.json`. The
`docker/builder.bun.lock` file is a generated, version-pinned artifact; do
not edit or maintain another package list.

When the Dashboard template dependencies change, regenerate this lockfile
using **Bun 1.3.14**, in a disposable directory:

```sh
tmp="$(mktemp -d)"
cp packages/svforge/templates/dashboard/package.json "$tmp/package.json"
docker run --rm --user "$(id -u):$(id -g)" \
  -e BUN_INSTALL_CACHE_DIR=/tmp/bun-cache \
  -v "$tmp:/work" -w /work oven/bun:1.3.14 \
  bun install --lockfile-only --ignore-scripts
cp "$tmp/bun.lock" docker/builder.bun.lock
rm -rf "$tmp"
```

The Dockerfile then requires `bun install --frozen-lockfile`, so stale or
incompatible lockfiles are rejected at build time.

The common builder can be updated without changing deployed applications.
Applications can adopt new builder versions **individually**, alongside
intentional updates of their own locked dependencies.

This first step does not publish an image, change any production deployment, or
claim savings before comparing builds using two or three real applications.
