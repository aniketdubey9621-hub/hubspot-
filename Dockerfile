# Single service: Fastify API + Vite-built SPA (one public URL for OAuth redirect + UI).
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server-prod
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CLIENT_DIST_PATH=/app/client/dist
ENV SERVE_STATIC=true
COPY --from=server-prod /app/server /app/server
COPY --from=client-build /app/client/dist /app/client/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.js"]
