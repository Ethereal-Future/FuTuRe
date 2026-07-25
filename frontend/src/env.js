/**
 * Environment variable validation
 *
 * Validates all VITE_* environment variables at startup.
 * In production, missing required variables throw immediately so the build
 * fails loudly rather than shipping a silently broken app.
 *
 * Add new variables here as the app grows — keep this file as the single
 * source of truth for what the frontend expects from the environment.
 */

/**
 * Schema definition for all recognised VITE_* variables.
 *
 * Each entry describes:
 *   - required  : whether the app cannot function without this value
 *   - description : human-readable explanation shown in error messages
 *   - validate  : optional extra check beyond "is it present?" — return an
 *                 error string on failure, or null/undefined on success
 */
const ENV_SCHEMA = {
  // ── Required ────────────────────────────────────────────────────────────────
  VITE_API_URL: {
    required: true,
    description: 'Base URL for the backend API (e.g. https://api.example.com)',
    validate: (value) => {
      try {
        new URL(value);
        return null;
      } catch {
        return `"${value}" is not a valid URL`;
      }
    },
  },

  // ── Optional ─────────────────────────────────────────────────────────────────
  VITE_VAPID_PUBLIC_KEY: {
    required: false,
    description: 'VAPID public key for Web Push notifications',
  },

  VITE_CDN_URL: {
    required: false,
    description: 'CDN base URL for serving static assets (leave empty for relative paths)',
    validate: (value) => {
      if (!value) return null; // empty string is fine — means "use relative paths"
      try {
        new URL(value);
        return null;
      } catch {
        return `"${value}" is not a valid URL`;
      }
    },
  },
};

// ── Validation logic ──────────────────────────────────────────────────────────

/**
 * Validates all environment variables defined in ENV_SCHEMA.
 *
 * @param {boolean} strict - When true (production), missing required vars throw.
 *                           When false (development), they only warn.
 * @returns {{ [key: string]: string | undefined }} The validated env object.
 * @throws {Error} In strict mode when one or more required vars are absent or invalid.
 */
function validateEnv(strict = false) {
  const errors = [];
  const warnings = [];
  const validated = {};

  for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
    const value = import.meta.env[key];
    const isEmpty = value === undefined || value === null || value === '';

    if (isEmpty) {
      if (schema.required) {
        const msg = `Missing required environment variable: ${key}\n  → ${schema.description}`;
        if (strict) {
          errors.push(msg);
        } else {
          warnings.push(msg);
        }
      }
      // Store undefined for missing optional vars so callers can use ?? defaults
      validated[key] = undefined;
      continue;
    }

    // Run the optional extra validator
    if (schema.validate) {
      const validationError = schema.validate(value);
      if (validationError) {
        const msg = `Invalid value for ${key}: ${validationError}\n  → ${schema.description}`;
        if (strict || schema.required) {
          errors.push(msg);
        } else {
          warnings.push(msg);
        }
      }
    }

    validated[key] = value;
  }

  if (warnings.length > 0) {
    console.warn(
      `[env] ${warnings.length} environment variable warning(s):\n` +
        warnings.map((w) => `  • ${w}`).join('\n')
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `[env] Build aborted — ${errors.length} environment variable error(s):\n` +
        errors.map((e) => `  • ${e}`).join('\n') +
        '\n\nCopy frontend/.env.example to frontend/.env and fill in the required values.'
    );
  }

  return validated;
}

// Run validation immediately when this module is imported.
// In production (import.meta.env.PROD) we use strict mode so the app never
// renders with a broken configuration.
const isProduction = import.meta.env.PROD;
export const env = validateEnv(isProduction);

// Convenience re-exports for the most commonly used vars
export const API_URL = env.VITE_API_URL;
export const VAPID_PUBLIC_KEY = env.VITE_VAPID_PUBLIC_KEY;
export const CDN_URL = env.VITE_CDN_URL;
