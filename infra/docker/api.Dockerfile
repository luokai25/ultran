# Multi-stage build for @ultran/api.
# The final image carries only the compiled output and production deps.

FROM node:20.11-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---- deps: install with the lockfile only, so this layer caches well ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/api/package.json services/api/
COPY packages/connectors/package.json packages/connectors/
RUN pnpm install --frozen-lockfile --filter @ultran/api...

# ---- build: compile TypeScript ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY services/api services/api
COPY packages/connectors packages/connectors
RUN pnpm --filter @ultran/connectors build \
 && pnpm --filter @ultran/api build \
 && pnpm --filter @ultran/api deploy --prod /out

# ---- runtime: minimal, non-root ----
FROM node:20.11-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

RUN addgroup -g 10001 ultran && adduser -u 10001 -G ultran -S ultran
COPY --from=build --chown=ultran:ultran /out ./

USER ultran
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
