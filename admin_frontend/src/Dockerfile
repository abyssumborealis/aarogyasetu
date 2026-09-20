# Builds the staff console and serves the static files. Caddy (web service) proxies /admin/ here.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# The browser calls the API through Caddy at /api (Caddy strips the prefix before it reaches FastAPI)
ENV VITE_API_URL=/api
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
