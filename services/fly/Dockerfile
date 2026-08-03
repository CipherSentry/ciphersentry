# Build context: services/
#   fly deploy -a ciphersentry --config fly.toml --dockerfile fly/Dockerfile --remote-only
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
COPY fly/start-public-b7.sh ./fly/start-public-b7.sh

ARG NATS_VERSION=2.10.24
RUN chmod +x ./fly/start-public.sh ./fly/start-public-b7.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       curl ca-certificates redis-server redis-tools \
       postgresql postgresql-client gosu \
  && curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}/nats-server-v${NATS_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 "nats-server-v${NATS_VERSION}-linux-amd64/nats-server" \
  && chmod +x /usr/local/bin/nats-server \
  && PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)" \
  && ln -sf "$PG_BIN/initdb" /usr/local/bin/initdb \
  && ln -sf "$PG_BIN/postgres" /usr/local/bin/postgres \
  && ln -sf "$PG_BIN/pg_isready" /usr/local/bin/pg_isready \
  && ln -sf "$PG_BIN/psql" /usr/local/bin/psql \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_PORT=8080
ENV PORT=8080
ENV INDEXER_UPSTREAM=http://127.0.0.1:8081
# Durable when /data volume present (start script); memory fallback otherwise
ENV INDEXER_MEMORY=0
ENV INDEXER_CH_MODE=memory
ENV INDEXER_FORCE_WS=0
ENV INDEXER_REQUIRE_NATS=1
ENV B7=1
ENV CS_ENV=production
ENV AUTH_REQUIRED=1
ENV REDIS_URL=redis://127.0.0.1:6379
ENV REDIS_REQUIRE=1
ENV NATS_URL=nats://127.0.0.1:4222
ENV NATS_REQUIRE=1
ENV PG_DSN=postgres://cent:cent@127.0.0.1:5432/ciphersentry
EXPOSE 8080
# Redis + NATS + Postgres(volume) + gateway + durable indexer
CMD ["./fly/start-public-b7.sh"]
