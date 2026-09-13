# syntax=docker/dockerfile:1.7

# ---- dependencies -----------------------------------------------------------
# Separated from the build so a source-only change does not re-resolve the
# dependency tree, which is the slowest part of the pipeline.
FROM node:26-alpine AS deps
# Node 26 no longer bundles corepack — it was unbundled after the deprecation in
# 25, so the plain `corepack enable` this used to run failed with
# "corepack: not found" and every image build since has died on this line.
# Installing it from npm restores the shim and keeps `packageManager` in
# package.json as the single place the pnpm version is written; pinning pnpm
# here instead would put that version in two files.
RUN npm i -g corepack@latest && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:26-alpine AS build
RUN npm i -g corepack@latest && corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm build

# ---- runtime ----------------------------------------------------------------
# Only .output ships. No source, no dev dependencies, no package manager.
FROM node:26-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini vips \
 && addgroup -g 1001 -S vestigian \
 && adduser -u 1001 -S vestigian -G vestigian

COPY --from=build --chown=vestigian:vestigian /app/.output ./.output

USER vestigian

ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# tini reaps zombies and forwards signals, so a deploy drains cleanly instead of
# being killed after the stop timeout.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
