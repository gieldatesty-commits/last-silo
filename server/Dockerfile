# Kontekst budowania: katalog główny repo (docker build -f server/Dockerfile .)
FROM node:22-slim AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
COPY config /app/config
ENV GAME_CONFIG_PATH=/app/config/game.yaml
EXPOSE 3000
CMD ["node", "dist/index.js"]
