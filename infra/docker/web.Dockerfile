# Build for the Next.js web console (@ultran/web).

FROM node:20.11-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/connectors/package.json packages/connectors/
RUN pnpm install --frozen-lockfile --filter @ultran/web...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/ui packages/ui
COPY packages/connectors packages/connectors
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ultran/web build

FROM node:20.11-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app

RUN addgroup -g 10001 ultran && adduser -u 10001 -G ultran -S ultran
COPY --from=build --chown=ultran:ultran /repo/apps/web/.next/standalone ./
COPY --from=build --chown=ultran:ultran /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=ultran:ultran /repo/apps/web/public ./apps/web/public

USER ultran
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
