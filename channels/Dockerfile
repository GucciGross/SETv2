FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# long-running listener — the process owns the Intelligence gateway connection
CMD ["npx", "tsx", "src/channel.ts"]
