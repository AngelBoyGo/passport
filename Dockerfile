# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS prisma-cli
WORKDIR /prisma-cli
RUN npm init -y && npm install prisma@6.19.0

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
# CRITICAL FIX: Prisma CLI + bin + full node_modules tree for migrate deploy
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli/node_modules ./prisma-cli/node_modules
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli/node_modules/prisma ./node_modules/prisma
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli/node_modules/.bin ./node_modules/.bin

USER nextjs
EXPOSE 3000

CMD ["sh", "-c", "./prisma-cli/node_modules/.bin/prisma migrate deploy && node server.js"]
