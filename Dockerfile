# Production image for Railway, Render, Fly.io or any Docker host.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
# Python for the agent's run_code tool, with common data/report libraries.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages pandas matplotlib requests beautifulsoup4 openpyxl python-docx \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home sandbox
ENV NODE_ENV=production \
    KESTREL_DATA_DIR=/data/tasks \
    KESTREL_SANDBOX=local \
    KESTREL_SANDBOX_UID=10001 \
    PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.mjs ./
RUN mkdir -p /data/tasks
EXPOSE 3000
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT}"]
