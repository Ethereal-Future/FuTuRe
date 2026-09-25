import fs from 'fs';
import path from 'path';
import { generateSRIHash } from './sriHash.js';
import logger from '../config/logger.js';

/**
 * Subresource Integrity only works when the hash is embedded in the HTML
 * `integrity="sha384-..."` attribute of the <script>/<link> tag that loads the
 * resource — browsers do not read response headers to decide whether to
 * execute a script (see #1121). This module computes real per-file SRI
 * hashes for the built frontend assets so server-rendered HTML (or an API
 * consumer) can inject valid `integrity` attributes.
 *
 * The manifest is rebuilt lazily and cached, invalidated by the assets
 * directory's mtime so a fresh frontend build is picked up without a restart.
 */

const DEFAULT_ALGORITHM = 'sha384';
const MANIFEST_EXTENSIONS = new Set(['.js', '.css']);

function resolveAssetsDir() {
  return process.env.STATIC_ASSETS_DIR
    ? path.resolve(process.env.STATIC_ASSETS_DIR)
    : path.resolve(process.cwd(), '../frontend/dist');
}

function walk(dir, base = dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, base));
    } else if (MANIFEST_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

let cache = { dir: null, mtimeKey: null, manifest: null };

function computeMtimeKey(dir, files) {
  // Cheap invalidation signal: newest mtime + file count. A real content
  // change (rebuild) always changes at least one file's mtime.
  let newest = 0;
  for (const file of files) {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs > newest) newest = mtimeMs;
    } catch {
      /* file may have been removed mid-scan */
    }
  }
  return `${dir}:${files.length}:${newest}`;
}

/**
 * Build (or return the cached) manifest of SRI hashes for built static assets.
 * @param {object} [options]
 * @param {string} [options.algorithm='sha384'] - Hash algorithm to use for the integrity attribute
 * @returns {{ assetsDir: string, algorithm: string, generatedAt: string, hashes: Record<string,string> }}
 */
export function getAssetIntegrityManifest({ algorithm = DEFAULT_ALGORITHM } = {}) {
  const assetsDir = resolveAssetsDir();
  const files = walk(assetsDir);
  const mtimeKey = computeMtimeKey(assetsDir, files);

  if (cache.dir === assetsDir && cache.mtimeKey === mtimeKey && cache.manifest?.algorithm === algorithm) {
    return cache.manifest;
  }

  const hashes = {};
  for (const file of files) {
    try {
      const content = fs.readFileSync(file);
      const relPath = '/' + path.relative(assetsDir, file).split(path.sep).join('/');
      hashes[relPath] = generateSRIHash(content, algorithm);
    } catch (err) {
      logger.warn('sriManifest.hashFailed', { file, error: err.message });
    }
  }

  const manifest = {
    assetsDir,
    algorithm,
    generatedAt: new Date().toISOString(),
    hashes,
  };

  cache = { dir: assetsDir, mtimeKey, manifest };
  return manifest;
}

/**
 * Look up the SRI integrity attribute value for a single asset path
 * (e.g. '/assets/index-abc123.js').
 * @returns {string|null}
 */
export function getAssetIntegrity(assetPath, options) {
  const manifest = getAssetIntegrityManifest(options);
  const key = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return manifest.hashes[key] ?? null;
}

/** Clears the in-memory manifest cache. Exposed for tests. */
export function clearManifestCache() {
  cache = { dir: null, mtimeKey: null, manifest: null };
}
