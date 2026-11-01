# FlowPay backend (history indexer + API). Build: docker build -t flowpay-api .
# Needs DATABASE_URL at runtime. Listens on $PORT (default 3001).
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY src/onchain-facts.ts ./src/onchain-facts.ts
ENV PORT=3001
EXPOSE 3001
USER bun
CMD ["bun", "run", "server/index.ts"]
