# One image for web, worker and migrate (ADR-001); Compose picks the command.
# Full node_modules rather than Next's standalone output: pino loads its
# transports by name at runtime, which file tracing can't see, and the worker
# runs TypeScript through tsx.
# Pinned by digest: a tag can change upstream with nothing in our diff. Bump with
# `docker buildx imagetools inspect node:24-slim`.
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS base
# xmllint validates SRI XML against the XSD from Milestone 3.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libxml2-utils \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Manifests only, so dependency layers survive source changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY tests/integration/package.json tests/integration/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @comprobify/web build

FROM manifests AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod
COPY . .
COPY --from=build /app/apps/web/.next apps/web/.next
RUN chown -R node:node apps/web/.next
USER node
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start"]
