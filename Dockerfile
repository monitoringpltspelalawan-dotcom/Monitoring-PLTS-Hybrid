FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server ./server
COPY --chown=node:node gateway ./gateway
COPY --from=frontend-build --chown=node:node /app/web/dist ./web/dist
RUN mkdir -p /app/data/reports && chown -R node:node /app/data
USER node
EXPOSE 8080 8883
CMD ["node", "server/index.js"]
