# Stage 1: Build
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src/

RUN npm run prisma:generate
RUN npm run build

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npm cache clean --force
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3333

CMD ["node", "dist/server.js"]
