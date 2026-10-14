# syntax=docker/dockerfile:1
# SVForge dashboard package.json is the only manually maintained package list.
# The lockfile below is generated from that same manifest with Bun 1.3.14.
FROM oven/bun:1.3.14

ENV BUN_INSTALL_CACHE_DIR=/bun-cache
WORKDIR /app

COPY packages/svforge/templates/dashboard/package.json ./package.json
COPY docker/builder.bun.lock ./bun.lock
RUN bun install --frozen-lockfile --ignore-scripts
