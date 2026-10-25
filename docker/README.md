# SVForge reusable Docker builder

Build a **versioned build image** from the existing SVForge Dashboard package
manifest. It preinstalls the common stack (Svelte/Vite/Skeleton/Auth/Drizzle,
etc.) and caches resolved packages in a common Docker image layer.
There is **no manually maintained second package list**.

The image is optional: SVForge consumers are free to use any deployment setup.
It does not change scaffold behavior and is never required at runtime.

## Build and tag a version

From the repository root:

```sh
version="$(node -p "require('./packages/svforge/package.json').version")"
docker build -f docker/builder.Dockerfile -t "svforge-builder:${version}" .
```

Publish that tag once, under a version you never overwrite:

```sh
docker tag "svforge-builder:${version}" registry.example.com/svforge/builder:${version}
docker push registry.example.com/svforge/builder:${version}
# Digest to pin (immutable):
docker buildx imagetools inspect registry.example.com/svforge/builder:${version} \
  --format '{{json .Manifest.Digest}}'
```

Consumers pin either the version tag or, preferably, the digest:
`FROM registry.example.com/svforge/builder:1.2.0@sha256:...`. A locally built
image is reused across applications on the same Docker host; sharing it across
hosts requires publishing/pulling it deliberately, which SVForge does not do
automatically.

## Validate the builder and a real consumer

`docker/builder-smoke.sh` builds the image from the current checkout and proves
the three things that can rot independently:

1. the image carries the **exact** checked-in Dashboard `package.json` and
   `docker/builder.bun.lock` (no second, drifting package list);
2. `bun install --frozen-lockfile --ignore-scripts` inside the image is a
   **no-op**, so the manifest and the pinned lockfile agree;
3. the preinstalled stack really **imports** with Bun (zod, svelte, vite,
   SvelteKit, Drizzle, Better Auth, postgres) and the Svelte component packages
   are present for a build stage.

`docker/consumer-smoke.sh` then builds the independent fixture application in
`docker/examples/app/` from that image and proves the consumer contract:

1. the build stage inherits the builder's common `node_modules` and its
   `BUN_INSTALL_CACHE_DIR`, so immutable image layers are actually reused;
2. the application's own `package.json`/`bun.lock` remain authoritative — the
   fixture pins zod 3.x (the builder has 4.x) and adds an app-only dependency
   (nanoid), both installed by the app's frozen install;
3. the runtime image is independent from the builder: it contains only the
   compiled server output and the app's production dependencies, and serves the
   compiled app.

```sh
bash docker/builder-smoke.sh
bash docker/consumer-smoke.sh   # builds the builder first if the tag is absent
```

Both scripts perform no registry push and touch no deployed application. CI
runs them in the `docker-builder` job whenever `docker/**` or the Dashboard
package manifest changes — for pull requests (diff against the base branch) and
for pushes (diff of the pushed commit range), so a documentation-only push never
rebuilds the image.

If a local Docker cache is corrupt (a BuildKit "parent snapshot does not exist"
error before any build step), build with a disposable isolated builder instead
of clearing the shared cache:

```sh
docker buildx create --name svforge-builder-iso --driver docker-container
SVFORGE_BUILDER_BUILDX_BUILDER=svforge-builder-iso bash docker/builder-smoke.sh
SVFORGE_BUILDER_BUILDX_BUILDER=svforge-builder-iso bash docker/consumer-smoke.sh
docker buildx rm svforge-builder-iso
```

## Use it from an independent application

Start the **build stage** from the pinned builder image, then install from the
application's own lockfile. `docker/examples/app/Dockerfile` is the full,
CI-validated example; its essential shape is:

```dockerfile
ARG BUILDER_IMAGE=registry.example.com/svforge/builder:1.2.0
FROM ${BUILDER_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM oven/bun:1.3.14 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/package.json /app/bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["bun", "./build/index.js"]
```

Key points:

- The application's `bun.lock` stays authoritative. Packages that match the
  builder are reused from the image/cache; different pins are installed in the
  app's layer; app-only dependencies are added there too.
- The runtime stage **does not inherit** the builder image and does not mount a
  shared dependency volume. Migrations are the application's explicit
  responsibility (e.g. Denden's `drizzle-kit`). Adapters differ per app
  (`adapter-node`, platform adapters, …).

### Reusing the Bun cache in consumer builds

The builder image sets `BUN_INSTALL_CACHE_DIR=/bun-cache`, inherited by the
build stage. To persist it across builds on the same host, mount it as a
BuildKit cache (requires the `# syntax=docker/dockerfile:1` frontend):

```dockerfile
RUN --mount=type=cache,target=/bun-cache bun install --frozen-lockfile --ignore-scripts
```

This is a host-local cache and is **not** shared automatically across hosts or
CI runners. Distribute it explicitly (for example with a registry cache) if that
matters for you. Docker layer reuse and the Bun cache reduce network/install
work; they do not deduplicate application-specific `node_modules` or final
production images, and no size or timing savings are guaranteed.

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
incompatible lockfiles are rejected at build time. Publish the refreshed stack
as a **new** builder version (for example `1.3.0`); keep the previous tags and
digests available. Applications adopt a new builder version individually,
alongside intentional updates of their own locked dependencies.

## Rollback

- Images are immutable: never retag or overwrite a published version. If a
  version is bad, publish a fixed new version.
- To roll an application back, restore its previous `BUILDER_IMAGE` tag or
  digest and rebuild the app image from that pinned reference. The old builder
  image remains available (pull it by digest if it was pruned locally).
- Nothing runs from the builder at runtime, so rolling back needs no runtime
  state migration; the app's own migrations remain unchanged.

## Adoption and scope

Denden #58 is the downstream adoption follow-up: use the versioned image with
the app's own lockfile, preserve migrations and the multistage runtime, with no
unsupervised deployment. This builder is not a universal deployment framework,
not a shared runtime `node_modules` mount, and not a global runtime package
store. SVForge does not publish or deploy this image automatically.
