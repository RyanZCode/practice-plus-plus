# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @practice-plus-plus/api build
RUN pnpm --config.inject-workspace-packages=true --filter @practice-plus-plus/api deploy --prod /prod/api

FROM node:${NODE_VERSION}-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /prod/api .

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/application/server.js"]
