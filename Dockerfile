# The agent's browser chat, packaged so it runs the same on any machine.
#   docker compose up --build   then open http://localhost:3100
FROM node:22-slim

WORKDIR /app

# Dependencies first: this layer is rebuilt only when package files change.
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json ./
COPY business ./business
COPY src ./src
COPY scripts/warm-cache.ts ./scripts/warm-cache.ts

# Bake the embedding model and the knowledge base's vectors into the image,
# so the container answers its first question without downloading anything.
RUN npx tsx scripts/warm-cache.ts

# Bookings, the outbox, the request log and the audit log are written here.
# The directory is handed to the unprivileged "node" user the app runs as.
RUN mkdir -p data/runtime && chown -R node:node data .cache node_modules/@huggingface/transformers/.cache
USER node

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["npx", "tsx", "src/interfaces/web/server.ts"]
