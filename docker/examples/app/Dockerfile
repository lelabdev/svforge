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

# Remember the builder's own zod version before the app install replaces it, so
# the guard below can prove which layer actually won (#689).
RUN bun -e 'const fs = require("node:fs"); fs.writeFileSync("/tmp/builder-zod", JSON.parse(fs.readFileSync("node_modules/zod/package.json", "utf8")).version);'

COPY package.json bun.lock ./
# The application's own lockfile stays authoritative: matching packages are
# reused from the image/cache, different pins are installed here, and
# app-specific dependencies are added in this layer.
RUN bun install --frozen-lockfile --ignore-scripts

# Fixture-only guard (drop this in a real app): prove the app's manifest and
# lockfile won version ownership over the builder, that the winning zod is on a
# patched release (>= 4.6.6, GHSA-mrhx-c7xc-m3w5), and that an app-only
# dependency (nanoid) was installed.
RUN bun -e '\
const fs = require("node:fs");\
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));\
const declared = read("package.json").dependencies.zod.replace(/^[\^~]/, "");\
const app = read("node_modules/zod/package.json").version;\
const builder = fs.readFileSync("/tmp/builder-zod", "utf8").trim();\
const nanoid = read("node_modules/nanoid/package.json").version;\
if (app !== declared) throw new Error(`app lockfile not respected: zod@${app}, manifest declares ${declared}`);\
if (app === builder) throw new Error(`version-ownership contract broken: builder and app both resolved zod@${app}`);\
if (app.localeCompare("4.6.6", "en", { numeric: true }) < 0) throw new Error(`zod@${app} is below the patched floor 4.6.6`);\
console.log(`app-deps zod@${app} (builder zod@${builder}) nanoid@${nanoid}`);\
'

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
