# syntax=docker/dockerfile:1
# Example: an independent application build stage on top of the reusable,
# versioned SVForge builder image. Replace the default tag with the immutable
# tag or digest you pinned (e.g. `svforge-builder:1.2.0` or `@sha256:...`).
ARG BUILDER_IMAGE=svforge-builder:local

FROM ${BUILDER_IMAGE} AS build
WORKDIR /app

# The build stage inherits the builder's immutable common node_modules and its
# Bun cache directory. This guard fails fast if that contract breaks.
RUN test -f node_modules/svelte/package.json \
 && test -f node_modules/@sveltejs/kit/package.json \
 && test -d "$BUN_INSTALL_CACHE_DIR" \
 && test "$BUN_INSTALL_CACHE_DIR" = "/bun-cache"

COPY package.json bun.lock ./
# The application's own lockfile stays authoritative: matching packages are
# reused from the image/cache, different pins are installed here, and
# app-specific dependencies are added in this layer.
RUN bun install --frozen-lockfile --ignore-scripts

# Fixture-only guard: prove the app pin (zod 3.x) won over the builder's 4.x and
# that an app-only dependency (nanoid) is installed. Drop this in a real app.
RUN bun -e 'const fs = require("node:fs"); const v = (p) => JSON.parse(fs.readFileSync(`node_modules/${p}/package.json`, "utf8")).version; const zod = v("zod"); const nanoid = v("nanoid"); if (!zod.startsWith("3.")) throw new Error(`app lockfile not respected: zod@${zod}`); console.log(`app-deps zod@${zod} nanoid@${nanoid}`);'

COPY . .
RUN bun run build

# Production dependencies, installed from the application manifest/lockfile in
# a clean stage so dev-only packages never leak into the runtime image.
FROM oven/bun:1.3.14 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Minimal runtime: it does NOT inherit the builder image and receives only the
# compiled server output plus production dependencies.
FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/package.json /app/bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["bun", "./build/index.js"]
