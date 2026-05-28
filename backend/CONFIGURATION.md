# Backend Configuration

The backend reads configuration from:

1. Runtime environment variables (`process.env`)
2. `.env*` files in `backend/` (fallbacks)

## Environments

Set `APP_ENV` to enable environment-specific defaults and validation:

- `development` (default)
- `test`
- `production`

## `.env` file loading

Files are loaded in this precedence order (later wins):

1. `.env`
2. `.env.<APP_ENV>`
3. `.env.local` (skipped when `APP_ENV=test`)
4. `.env.<APP_ENV>.local` (skipped when `APP_ENV=test`)

`process.env` always overrides values from files.

## Required variables (production)

When `APP_ENV=production`:

- `ALLOWED_ORIGINS` (comma-separated)
- `JWT_SECRET` (must not be `secret`)

## Hot-reloading

Set `CONFIG_WATCH=true` to reload config when `.env*` files change.

- Changes apply to consumers that call `getConfig()` at runtime (e.g. CORS origin checks).
- Some values (like `PORT`) are still read once at startup.

## Encrypted secrets (optional)

You can store encrypted values using `ENC(<base64>)` or `enc:<base64>`, and provide a key via:

- `CONFIG_ENCRYPTION_KEY` (preferred)
- `CONFIG_SECRET_KEY` (alias)

The code uses AES-256-GCM with a SHA-256 derived key. See `backend/src/config/secrets.js`.

