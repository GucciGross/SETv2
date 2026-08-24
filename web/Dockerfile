# SET frontend (built static bundle served by nginx)
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-tls.conf /etc/nginx/nginx-tls.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-set-tls.sh
RUN chmod +x /docker-entrypoint.d/40-set-tls.sh
EXPOSE 80 443
