# SilentCatch frontend — Next 14 multi-stage (docker-expert skill pattern)
# Build context: repo ROOT (dockerfile: frontend/Dockerfile)
# node:26 + npm ci: lockfile is npm-12-generated; npm 10 (node:20) false-positives
# a sync error on nested picomatch ranges (local `npm ci --dry-run` exits 0).
FROM node:26-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
# Rebuild static/assets tree exactly where standalone runtime expects it
RUN mkdir -p .next
COPY --from=builder /app/.next/static ./.next/static
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
