# ============================================
# Stage 1: Build
# ============================================
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

RUN npx prisma generate
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-slim AS production

# Install Chromium dependencies for Puppeteer (whatsapp-web.js)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    ca-certificates \
    wget \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

# Create app user for security
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads /app/.wwebjs_auth /app/.wwebjs_cache \
    && chown -R appuser:appuser /home/appuser /app

WORKDIR /app

# Copy built app from builder
COPY --from=builder --chown=appuser:appuser /app/package.json /app/package-lock.json* ./
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/build ./build
COPY --from=builder --chown=appuser:appuser /app/public ./public
COPY --from=builder --chown=appuser:appuser /app/prisma ./prisma
COPY --from=builder --chown=appuser:appuser /app/app/queues ./app/queues
COPY --from=builder --chown=appuser:appuser /app/app/services ./app/services
COPY --from=builder --chown=appuser:appuser /app/app/utils ./app/utils
COPY --from=builder --chown=appuser:appuser /app/app/webhooks ./app/webhooks
COPY --from=builder --chown=appuser:appuser /app/app/db.server.js ./app/db.server.js
COPY --from=builder --chown=appuser:appuser /app/docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh

# Production-only deps (skip devDeps)
RUN npm prune --production 2>/dev/null; exit 0

# Regenerate Prisma client for the production OS
RUN npx prisma generate

USER appuser

# Expose port
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/docker-entrypoint.sh"]
