# syntax=docker/dockerfile:1

ARG NODE_VERSION=25.8.2

FROM node:${NODE_VERSION}-bookworm-slim AS pnpm-base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN npm install --global pnpm@11.9.0

WORKDIR /app

FROM pnpm-base AS build-deps

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bookmeter/package.json apps/bookmeter/package.json
COPY apps/reading-recommender/package.json apps/reading-recommender/package.json

RUN pnpm install --frozen-lockfile --filter @bookmaker/reading-recommender...

FROM build-deps AS builder

COPY apps/reading-recommender apps/reading-recommender

RUN pnpm --filter @bookmaker/reading-recommender run build

FROM pnpm-base AS prod-deps

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bookmeter/package.json apps/bookmeter/package.json
COPY apps/reading-recommender/package.json apps/reading-recommender/package.json

RUN pnpm install --frozen-lockfile --prod --filter @bookmaker/reading-recommender...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/app
ENV PORT=4174
ENV BOOKS_DB_PATH=/source/books.sqlite
ENV READING_RECOMMENDER_DB_PATH=/state/reading-recommender.sqlite

WORKDIR /app

COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/reading-recommender/package.json ./apps/reading-recommender/package.json
COPY --from=prod-deps /app/apps/reading-recommender/node_modules ./apps/reading-recommender/node_modules
COPY --from=builder /app/apps/reading-recommender/dist ./apps/reading-recommender/dist

EXPOSE 4174

CMD ["node", "apps/reading-recommender/dist/server/server/index.js"]
