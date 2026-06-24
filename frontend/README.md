# Frontend

React + Vite SPA for the Stellar Remittance Platform. Runs on port `3000` in development.

## Requirements

- Node.js 20+

## Local Development

```bash
cp .env.example .env
# set VITE_API_URL in .env (or leave empty to use the Vite proxy to localhost:3001)

npm install
npm run dev
```

## Docker

### Build

`VITE_API_URL` is baked into the static bundle at build time — pass it as a build argument:

```bash
docker build --build-arg VITE_API_URL=https://api.example.com -t stellar-frontend .
```

### Run

```bash
docker run -p 80:80 stellar-frontend
```

The container serves the compiled SPA via Nginx on port `80`.

### Docker Compose example

```yaml
services:
  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: https://api.example.com
    ports:
      - "80:80"
```

## Nginx

`nginx.conf` configures:

- SPA routing fallback (`try_files` → `/index.html`) for client-side routes
- Immutable long-term caching for hashed JS/CSS/image assets
- `no-cache` on `index.html` so new deploys are picked up immediately
- Gzip compression for text responses
