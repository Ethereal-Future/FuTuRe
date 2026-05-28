import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { maybeDecryptEnvValue } from './secrets.js';

export const CONFIG_SCHEMA_VERSION = 1;

const emitter = new EventEmitter();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..', '..');

let watchers = [];
let reloadTimer = null;

export let config = loadConfig({ startWatch: true });

export function getConfig() {
  return config;
}

export function onConfigChange(listener) {
  emitter.on('change', listener);
  return () => emitter.off('change', listener);
}

export function reloadConfig() {
  return applyNewConfig(loadConfig({ startWatch: true }), { emit: true });
}

export function closeConfigWatchers() {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
}

function applyNewConfig(newConfig, { emit }) {
  config = newConfig;
  if (emit) emitter.emit('change', config);
  return config;
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    try {
      applyNewConfig(loadConfig({ startWatch: true }), { emit: true });
      console.log('[config] reloaded');
    } catch (error) {
      console.error('[config] reload failed:', error?.message ?? error);
    }
  }, 150);
  reloadTimer.unref?.();
}

function normalizeAppEnv(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'development';
  if (raw === 'prod') return 'production';
  if (raw === 'dev') return 'development';
  return raw;
}

function parseBoolean(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function parseInteger(value, { envVarName, defaultValue } = {}) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const num = Number.parseInt(String(value), 10);
  if (!Number.isFinite(num)) {
    throw new Error(`${envVarName} must be an integer`);
  }
  return num;
}

function parseCsv(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function resolveEncryptionKey(env) {
  const key = env.CONFIG_ENCRYPTION_KEY || env.CONFIG_SECRET_KEY;
  if (typeof key !== 'string') return undefined;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return dotenv.parse(content);
}

function safeReadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, env: {} };
    return { exists: true, env: readEnvFile(filePath) };
  } catch (error) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${error?.message ?? error}`);
  }
}

function getEnvFilePaths(appEnv) {
  const envName = normalizeAppEnv(appEnv);
  const isTest = envName === 'test';

  const base = path.join(backendRoot, '.env');
  const envSpecific = path.join(backendRoot, `.env.${envName}`);

  // Keep test runs deterministic by ignoring *.local unless explicitly set in process.env
  const local = isTest ? null : path.join(backendRoot, '.env.local');
  const envLocal = isTest ? null : path.join(backendRoot, `.env.${envName}.local`);

  return [base, envSpecific, local, envLocal].filter(Boolean);
}

function inferAppEnvFromBaseFiles() {
  const baseEnv = safeReadEnvFile(path.join(backendRoot, '.env'));
  const localEnv = safeReadEnvFile(path.join(backendRoot, '.env.local'));

  const mergedForInference = {
    ...baseEnv.env,
    ...localEnv.env,
    ...process.env,
  };

  return normalizeAppEnv(mergedForInference.APP_ENV || mergedForInference.NODE_ENV || 'development');
}

function loadConfig({ startWatch }) {
  const appEnv = normalizeAppEnv(process.env.APP_ENV || process.env.NODE_ENV || inferAppEnvFromBaseFiles());
  const nodeEnv = typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : undefined;

  const envFiles = getEnvFilePaths(appEnv);
  const envFromFiles = {};
  const loadedEnvFiles = [];

  for (const file of envFiles) {
    const { exists, env } = safeReadEnvFile(file);
    if (!exists) continue;
    Object.assign(envFromFiles, env);
    loadedEnvFiles.push(file);
  }

  const combinedEnv = { ...envFromFiles, ...process.env };
  const newConfig = createConfigFromEnv(combinedEnv, { appEnv, nodeEnv, loadedEnvFiles });

  const shouldWatch = Boolean(startWatch) && newConfig.config.watch;
  if (!shouldWatch) {
    closeConfigWatchers();
    return newConfig;
  }

  restartWatchers(loadedEnvFiles);
  return newConfig;
}

function restartWatchers(files) {
  closeConfigWatchers();

  for (const file of files) {
    try {
      const watcher = fs.watch(file, { persistent: false }, () => scheduleReload());
      watcher.unref?.();
      watchers.push(watcher);
    } catch (error) {
      console.warn(`[config] failed to watch ${path.basename(file)}:`, error?.message ?? error);
    }
  }
}

function parseStellarNetwork(raw, { appEnv, envVarName }) {
  const fallback = appEnv === 'production' ? 'mainnet' : 'testnet';
  const value = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
  const normalized = value.toLowerCase();

  if (normalized === 'public') return 'mainnet';
  if (normalized === 'mainnet' || normalized === 'testnet') return normalized;

  throw new Error(`${envVarName} must be "testnet" or "mainnet"`);
}

function assertValidPort(port, { envVarName }) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${envVarName} must be a valid TCP port`);
  }
}

function assertValidUrl(url, { envVarName }) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`${envVarName} must be a valid URL`);
  }
}

function requiredString(value, { envVarName }) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${envVarName} is required`);
  }
  return value.trim();
}

export function createConfigFromEnv(env, { appEnv, nodeEnv, loadedEnvFiles } = {}) {
  const resolvedAppEnv = normalizeAppEnv(appEnv || env.APP_ENV || env.NODE_ENV || 'development');
  const resolvedNodeEnv =
    typeof nodeEnv === 'string' && nodeEnv.trim().length > 0 ? nodeEnv.trim() : env.NODE_ENV;

  const encryptionKey = resolveEncryptionKey(env);

  const configVersion = parseInteger(env.CONFIG_VERSION, {
    envVarName: 'CONFIG_VERSION',
    defaultValue: CONFIG_SCHEMA_VERSION,
  });
  if (configVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported CONFIG_VERSION=${configVersion}. Expected ${CONFIG_SCHEMA_VERSION}.`
    );
  }

  const port = parseInteger(env.PORT, { envVarName: 'PORT', defaultValue: 3001 });
  assertValidPort(port, { envVarName: 'PORT' });

  const stellarNetwork = parseStellarNetwork(env.STELLAR_NETWORK, {
    appEnv: resolvedAppEnv,
    envVarName: 'STELLAR_NETWORK',
  });

  const defaultHorizonUrl =
    stellarNetwork === 'testnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';

  const horizonUrl = maybeDecryptEnvValue(env.HORIZON_URL ?? defaultHorizonUrl, encryptionKey, {
    envVarName: 'HORIZON_URL',
  });
  assertValidUrl(horizonUrl, { envVarName: 'HORIZON_URL' });

  const assetIssuerRaw = env.ASSET_ISSUER;
  const assetIssuer =
    typeof assetIssuerRaw === 'string' && assetIssuerRaw.trim().length > 0
      ? maybeDecryptEnvValue(assetIssuerRaw.trim(), encryptionKey, { envVarName: 'ASSET_ISSUER' })
      : undefined;

  const allowedOriginsFromEnv = parseCsv(
    maybeDecryptEnvValue(env.ALLOWED_ORIGINS, encryptionKey, { envVarName: 'ALLOWED_ORIGINS' })
  );
  const allowedOriginsDefault = ['http://localhost:3000', 'http://localhost:5173'];
  const allowedOrigins =
    allowedOriginsFromEnv.length > 0 ? allowedOriginsFromEnv : allowedOriginsDefault;

  if (resolvedAppEnv === 'production' && allowedOriginsFromEnv.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required in production');
  }

  const jwtSecretRaw =
    typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : resolvedAppEnv === 'production' ? '' : 'secret';
  const jwtSecret = maybeDecryptEnvValue(jwtSecretRaw, encryptionKey, { envVarName: 'JWT_SECRET' });
  if (resolvedAppEnv === 'production') {
    const secret = requiredString(jwtSecret, { envVarName: 'JWT_SECRET' });
    if (secret === 'secret') {
      throw new Error('JWT_SECRET must not be the default value in production');
    }
  }

  const watchFlag = parseBoolean(env.CONFIG_WATCH);
  const watchEnabled = resolvedAppEnv !== 'test' && watchFlag;

  return {
    meta: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      configVersion,
      appEnv: resolvedAppEnv,
      nodeEnv: resolvedNodeEnv,
      loadedEnvFiles: Array.isArray(loadedEnvFiles) ? loadedEnvFiles : [],
      loadedAt: new Date().toISOString(),
    },
    config: {
      watch: watchEnabled,
    },
    server: {
      port,
    },
    cors: {
      allowedOrigins,
    },
    stellar: {
      network: stellarNetwork,
      horizonUrl,
      assetIssuer,
    },
    security: {
      jwtSecret,
    },
  };
}
