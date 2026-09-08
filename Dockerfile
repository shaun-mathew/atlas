FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json playwright.config.ts vite.config.ts ./
COPY src ./src
COPY server ./server
COPY public ./public
# The existing build typechecks both application and test sources.
COPY tests ./tests
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/app/data/accounts.sqlite
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# The server shares progress validation and geography data with the client.
COPY --from=build /app/src ./src
RUN mkdir /app/data && chown node:node /app/data

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e 'Promise.all(["/", "/api/account"].map(path => fetch("http://127.0.0.1:8080" + path).then(r => { if (!r.ok) throw Error(r.status); }))).catch(() => process.exit(1))'
CMD ["node", "--import", "tsx", "server/index.ts"]
