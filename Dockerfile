FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY src/shared/package.json src/shared/
COPY src/server/package.json src/server/
COPY src/client/package.json src/client/
RUN npm ci
COPY . .
RUN npx prisma generate
ARG VITE_LIVEKIT_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/server/dist ./src/server/dist
COPY --from=builder /app/src/client/dist ./src/client/dist
COPY --from=builder /app/src/shared/dist ./src/shared/dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Startup script: run migrations + seed, then start app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "src/server/dist/index.js"]
