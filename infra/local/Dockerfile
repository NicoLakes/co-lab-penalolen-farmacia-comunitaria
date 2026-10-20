# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
RUN npm install --global pnpm@11.1.2
WORKDIR /workspace
RUN chown node:node /workspace
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node packages/database/package.json ./packages/database/package.json
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm --filter @farmacia/database build
ENV NODE_ENV=development
