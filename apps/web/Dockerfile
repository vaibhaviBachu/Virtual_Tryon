# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /srv
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /srv
COPY --from=deps /srv/node_modules ./node_modules
COPY apps/web ./
# NEXT_PUBLIC_* values must be present at build time (they're inlined into the client
# bundle) — docker-compose passes them as build args per docs/development.md.
ARG NEXT_PUBLIC_API_URL=http://localhost:2002
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /srv
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /srv/public ./public
COPY --from=builder /srv/.next/standalone ./
COPY --from=builder /srv/.next/static ./.next/static

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
