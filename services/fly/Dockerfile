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

ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "gateway", "-w", "gateway"]
