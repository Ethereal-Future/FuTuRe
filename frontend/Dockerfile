# syntax=docker/dockerfile:1
# Stage 1: build static assets
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# Stage 2: serve with Nginx as a non-root user.
# Port 80 requires root, so the runtime listens on 8080.
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Master process must not try to drop privileges (already running as nginx),
# and pid/cache/log paths must be writable by that user.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
 && sed -i 's|pid .*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp \
 && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
 && chmod -R g+w /var/cache/nginx /var/log/nginx

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
