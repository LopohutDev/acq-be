FROM node:20-alpine AS deps

WORKDIR /app

ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_URL=$DATABASE_URL

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

RUN npx prisma generate

FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 8080

ENV PORT=8080

CMD ["node", "dist/main.js"]
