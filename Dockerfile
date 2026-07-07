FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV API_PORT=4000

EXPOSE 4000

CMD ["./docker-entrypoint.sh"]
