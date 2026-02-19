FROM node:20-alpine AS builder

WORKDIR /app

ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_URL=$DATABASE_URL

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

RUN npx prisma generate

COPY . .

RUN npm run build && ls -la dist/

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

RUN printf '#!/bin/sh\nset -a\n[ -f /secrets/.env ] && . /secrets/.env\nset +a\nexec node dist/main.js\n' > /app/start.sh && chmod +x /app/start.sh

RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 8080

ENV PORT=8080

CMD ["/app/start.sh"]
