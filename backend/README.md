# Backend

Node.js + Express API for the Stellar Remittance Platform. Runs on port `3001` by default.

## Requirements

- Node.js 20+
- PostgreSQL
- Redis (optional, for caching)

## Local Development

```bash
cp .env.example .env
# edit .env with your DATABASE_URL and other settings

npm install
npx prisma migrate deploy
node src/server.js
```

See `CONFIGURATION.md` for all environment variables.

## Docker

### Build

```bash
docker build -t stellar-backend .
```

### Run

```bash
docker run -p 3001:3001 --env-file .env stellar-backend
```

The container exposes port `3001`. Pass a different port via the `PORT` env variable:

```bash
docker run -p 8080:8080 -e PORT=8080 --env-file .env stellar-backend
```

### Database migrations

Migrations are not run automatically on container start. Run them separately before the first start (or as an init container):

```bash
docker run --rm --env-file .env stellar-backend \
  node -e "import('./src/db/migrate.js')"
```

Or via `npx prisma migrate deploy` with `DATABASE_URL` set.

### Health check

The image has a built-in `HEALTHCHECK` on `GET /health`. You can also check it manually:

```bash
curl http://localhost:3001/health
```

### Docker Compose example

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: ./backend/.env
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stellar
      POSTGRES_USER: stellar
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stellar"]
      interval: 10s
      timeout: 5s
      retries: 5
```
