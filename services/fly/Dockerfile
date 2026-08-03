# Build context: services/
#   fly deploy -c services/fly/fly.gateway.toml --dockerfile services/fly/Dockerfile
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY bus/package.json ./bus/
COPY gateway/package.json ./gateway/
COPY verifier-daemon/package.json ./verifier-daemon/
COPY indexer/package.json ./indexer/

RUN npm ci --omit=dev

COPY bus ./bus
COPY gateway ./gateway
COPY verifier-daemon ./verifier-daemon
COPY indexer ./indexer
COPY fly/start-public.sh ./fly/start-public.sh

RUN chmod +x ./fly/start-public.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_PORT=8080
ENV PORT=8080
ENV INDEXER_UPSTREAM=http://127.0.0.1:8081
ENV INDEXER_MEMORY=1
ENV INDEXER_FORCE_WS=1
ENV NATS_URL=
EXPOSE 8080
# gateway + embedded memory indexer (path proxy on gateway)
CMD ["./fly/start-public.sh"]
