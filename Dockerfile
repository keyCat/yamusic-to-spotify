# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NUXT_DATA_DIR=/app/data

WORKDIR /app
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app app \
    && mkdir --parents /app/data \
    && chown app:app /app/data

COPY --from=build --chown=app:app /app/.output ./.output

USER app
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
