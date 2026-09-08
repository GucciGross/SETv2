# SET backend
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY sql ./sql
COPY src ./src
COPY scripts ./scripts
RUN npm run h5p:setup
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/importers/data ./dist/importers/data
COPY --from=build /app/sql ./sql
COPY --from=build /app/h5p-assets ./h5p-assets
RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "dist/index.js"]
