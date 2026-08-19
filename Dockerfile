FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run test:navigator
RUN npm run test:thumbnails
RUN npm run lint
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ARG APP_VERSION=v1.2
LABEL org.opencontainers.image.title="Brooks PA Atlas" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/app/data/dev.db \
    BROOKS_LIBRARY_ROOT=/app/data/library/images \
    BROOKS_THUMBNAIL_ROOT=/app/data/library/thumbnails \
    BROOKS_OCR_COMMAND=tesseract \
    BROOKS_OCR_LANG=chi_sim+eng

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-noto-cjk \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
    && apt-get clean

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /app/data/library/images \
    && chown -R nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/app/data"]

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
