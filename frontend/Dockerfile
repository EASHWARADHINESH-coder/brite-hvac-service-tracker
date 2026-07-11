# Frontend image: build the React app, then serve it (and proxy /api) with nginx.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- serve stage ----
FROM nginx:alpine
# SPA + /api reverse-proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
