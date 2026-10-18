import prisma from '../db/client.js';
import { logAdminAction } from '../db/adminAuditLog.js';
import logger from '../config/logger.js';
import { resolveRedisConfig } from '../cache/redis.js';

// In-memory L1 cache for fast lookups, kept coherent via Redis pub/sub
const whitelistedIPsCache = new Map();
let cacheInitialized = false;

// Redis pub/sub infrastructure for distributed cache invalidation
const WHITELIST_CACHE_PREFIX = 'ip_whitelist:';
const WHITELIST_UPDATE_CHANNEL = 'ip_whitelist:updates';
const WHITELIST_CACHE_TTL_SECONDS = 3600; // 1 hour

let redisInit = null;
let publisher = null;
let subscriber = null;

// Validate IPv4 address format
function isValidIPv4(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => parseInt(part, 10) <= 255);
}

// Validate IPv6 address format
function isValidIPv6(ip) {
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?)$/;
  return ipv6Regex.test(ip);
}

// Validate CIDR notation
function isValidCIDR(cidr) {
  const [ip, prefix] = cidr.split('/');
  if (!prefix || isNaN(parseInt(prefix, 10))) return false;
  const prefixNum = parseInt(prefix, 10);
  const isIPv4 = isValidIPv4(ip);
  const isIPv6 = isValidIPv6(ip);
  if (!isIPv4 && !isIPv6) return false;
  if (isIPv4 && (prefixNum < 0 || prefixNum > 32)) return false;
  if (isIPv6 && (prefixNum < 0 || prefixNum > 128)) return false;
  return true;
}

// Validate IP address (IPv4, IPv6, or CIDR)
function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  if (ip.includes('/')) return isValidCIDR(ip);
  return isValidIPv4(ip) || isValidIPv6(ip);
}

function ipv4ToBigInt(ip) {
  return ip.split('.').reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6ToBigInt(ip) {
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':').filter(Boolean) : [];
  const right = tail ? tail.split(':').filter(Boolean) : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || '0'}`), 0n);
}

function ipToBigInt(ip) {
  if (isValidIPv4(ip)) return { value: ipv4ToBigInt(ip), bits: 32 };
  if (isValidIPv6(ip)) return { value: ipv6ToBigInt(ip), bits: 128 };
  return null;
}

// ── Redis plumbing for distributed cache invalidation ────────────────────────

async function initRedis() {
  const resolved = resolveRedisConfig();
  if (!resolved) {
    logger.info('Redis not configured for IP whitelist - using local cache only');
    return;
  }
  
  let Redis;
  try {
    ({ default: Redis } = await import('ioredis'));
  } catch {
    logger.warn('ioredis not available - IP whitelist will use local cache only');
    return;
  }

  const make = () => (resolved.url ? new Redis(resolved.url, resolved.options) : new Redis(resolved.options));
  
  try {
    publisher = make();
    publisher.on('error', (err) => {
      logger.warn('IP whitelist Redis publisher error', { error: err.message });
    });
    await publisher.connect();

    subscriber = make();
    subscriber.on('error', (err) => {
      logger.warn('IP whitelist Redis subscriber error', { error: err.message });
    });
    await subscriber.connect();
    await subscriber.subscribe(WHITELIST_UPDATE_CHANNEL);
    
    // Handle cache invalidation messages from other instances
    subscriber.on('message', (channel, message) => {
      if (channel !== WHITELIST_UPDATE_CHANNEL) return;
      
      try {
        const update = JSON.parse(message);
        
        switch (update.action) {
          case 'add':
            if (update.entry) {
              whitelistedIPsCache.set(update.entry.ipAddress, update.entry);
              logger.debug('IP whitelist cache updated via pub/sub', { 
                action: 'add', 
                ip: update.entry.ipAddress 
              });
            }
            break;
            
          case 'remove':
            if (update.ip) {
              whitelistedIPsCache.delete(update.ip);
              logger.debug('IP whitelist cache updated via pub/sub', { 
                action: 'remove', 
                ip: update.ip 
              });
            }
            break;
            
          case 'clear':
            whitelistedIPsCache.clear();
            logger.debug('IP whitelist cache cleared via pub/sub');
            break;
            
          case 'reload':
            // Force reload from database on next check
            cacheInitialized = false;
            whitelistedIPsCache.clear();
            logger.info('IP whitelist reload triggered via pub/sub');
            break;
        }
      } catch (err) {
        logger.warn('Failed to process IP whitelist cache update', { 
          error: err.message 
        });
      }
    });

    logger.info('IP whitelist Redis pub/sub initialized');
  } catch (err) {
    logger.warn('Failed to initialize IP whitelist Redis pub/sub', { 
      error: err.message 
    });
    publisher = null;
    subscriber = null;
  }
}

function ensureRedis() {
  if (!redisInit) {
    redisInit = initRedis().catch((err) => {
      logger.warn('IP whitelist Redis initialization failed', { error: err.message });
    });
  }
  return redisInit;
}

function redisReady(client) {
  return client && client.status === 'ready';
}

/**
 * Publish a cache invalidation message to all other instances.
 * Failures are logged but don't fail the operation since the database
 * is the source of truth.
 */
async function publishCacheUpdate(update) {
  await ensureRedis();
  if (!redisReady(publisher)) {
    logger.debug('Redis not available - cache update not published', { update });
    return;
  }
  
  try {
    const message = JSON.stringify(update);
    await publisher.publish(WHITELIST_UPDATE_CHANNEL, message);
    logger.debug('Published IP whitelist cache update', { update });
  } catch (err) {
    logger.warn('Failed to publish IP whitelist cache update', { 
      error: err.message, 
      update 
    });
  }
}

/**
 * Write an IP whitelist entry to Redis cache.
 * Used during initialization and after database writes.
 */
async function writeCachedEntry(entry) {
  await ensureRedis();
  if (!redisReady(publisher)) return;
  
  try {
    const key = `${WHITELIST_CACHE_PREFIX}${entry.ipAddress}`;
    const value = JSON.stringify(entry);
    await publisher.set(key, value, 'EX', WHITELIST_CACHE_TTL_SECONDS);
  } catch (err) {
    logger.debug('Failed to write IP whitelist entry to Redis', { 
      error: err.message, 
      ip: entry.ipAddress 
    });
  }
}

/**
 * Read an IP whitelist entry from Redis cache.
 * Falls back to database if Redis is unavailable.
 */
async function readCachedEntry(ip) {
  await ensureRedis();
  if (!redisReady(publisher)) return null;
  
  try {
    const key = `${WHITELIST_CACHE_PREFIX}${ip}`;
    const raw = await publisher.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.debug('Failed to read IP whitelist entry from Redis', { 
      error: err.message, 
      ip 
    });
    return null;
  }
}

/**
 * Remove an IP whitelist entry from Redis cache.
 */
async function deleteCachedEntry(ip) {
  await ensureRedis();
  if (!redisReady(publisher)) return;
  
  try {
    const key = `${WHITELIST_CACHE_PREFIX}${ip}`;
    await publisher.del(key);
  } catch (err) {
    logger.debug('Failed to delete IP whitelist entry from Redis', { 
      error: err.message, 
      ip 
    });
  }
}

function isIPInCIDR(ip, cidr) {
  const [network, prefixText] = cidr.split('/');
  const addressValue = ipToBigInt(ip);
  const networkValue = ipToBigInt(network);
  const prefix = Number(prefixText);
  if (!addressValue || !networkValue || addressValue.bits !== networkValue.bits || !Number.isInteger(prefix)) {
    return false;
  }
  const mask = prefix === 0
    ? 0n
    : ((1n << BigInt(addressValue.bits)) - 1n) << BigInt(addressValue.bits - prefix);
  return (addressValue.value & mask) === (networkValue.value & mask);
}

// Initialize cache from database
async function initializeCache() {
  if (cacheInitialized) return;

  try {
    // Initialize Redis pub/sub (non-blocking if Redis unavailable)
    await ensureRedis();

    const entries = await prisma.iPWhitelist.findMany();
    
    // Populate in-memory cache
    entries.forEach(entry => {
      whitelistedIPsCache.set(entry.ipAddress, entry);
    });

    // Warm Redis cache in background (don't block initialization)
    if (redisReady(publisher)) {
      Promise.all(entries.map(entry => writeCachedEntry(entry))).catch(err => {
        logger.warn('Failed to warm Redis IP whitelist cache', { error: err.message });
      });
    }

    // Also load from environment variable for backward compatibility
    const envWhitelist = process.env.RATE_LIMIT_WHITELIST
      ? process.env.RATE_LIMIT_WHITELIST.split(',').map(ip => ip.trim())
      : [];

    for (const ip of envWhitelist) {
      if (isValidIP(ip) && !whitelistedIPsCache.has(ip)) {
        const entry = { ipAddress: ip, reason: 'Environment variable' };
        whitelistedIPsCache.set(ip, entry);
        
        // Cache env-based entries in Redis too
        if (redisReady(publisher)) {
          writeCachedEntry(entry).catch(() => {});
        }
      }
    }

    cacheInitialized = true;
    logger.info('IP whitelist cache initialized', {
      count: whitelistedIPsCache.size,
      redisEnabled: redisReady(publisher),
    });
  } catch (error) {
    logger.error('Failed to initialize IP whitelist cache', {
      error: error.message,
    });
  }
}

// Check if IP is whitelisted
async function isWhitelisted(ip) {
  if (!ip) return false;
  
  // Initialize cache if needed
  if (!cacheInitialized) {
    await initializeCache();
  }
  
  // Fast path: check in-memory cache
  if (whitelistedIPsCache.has(ip)) return true;
  
  // Check CIDR ranges in memory cache
  for (const [entryIp, entry] of whitelistedIPsCache.entries()) {
    const cidr = entry?.cidr || (entryIp.includes('/') ? entryIp : null);
    if (cidr && isIPInCIDR(ip, cidr)) return true;
  }
  
  // If Redis is available, check if we missed an update (cache miss recovery)
  const redisEntry = await readCachedEntry(ip);
  if (redisEntry) {
    // Update local cache and return true
    whitelistedIPsCache.set(ip, redisEntry);
    logger.debug('IP whitelist cache miss recovered from Redis', { ip });
    return true;
  }
  
  return false;
}

// Add IP to whitelist
async function addToWhitelist(ip, reason = null, adminId = null) {
  if (!isValidIP(ip)) {
    throw new Error(`Invalid IP address or CIDR notation: ${ip}`);
  }

  if (whitelistedIPsCache.has(ip)) {
    throw new Error(`IP address already whitelisted: ${ip}`);
  }

  try {
    const entry = await prisma.iPWhitelist.create({
      data: {
        ipAddress: ip,
        cidr: ip.includes('/') ? ip : null,
        reason,
        addedBy: adminId,
      },
    });

    // Update local cache immediately
    whitelistedIPsCache.set(ip, entry);

    // Write to Redis cache
    await writeCachedEntry(entry);

    // Notify other instances via pub/sub
    await publishCacheUpdate({ action: 'add', entry });

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_IP_ADD', 'IP_WHITELIST', ip, { reason });
    }

    logger.info('IP added to whitelist', { ip, reason, adminId });
    return entry;
  } catch (error) {
    if (error.code === 'P2002') {
      throw new Error(`IP address already whitelisted: ${ip}`);
    }
    throw error;
  }
}

// Remove IP from whitelist
async function removeFromWhitelist(ip, adminId = null) {
  if (!ip) return;

  if (!whitelistedIPsCache.has(ip)) {
    throw new Error(`IP address not in whitelist: ${ip}`);
  }

  try {
    await prisma.iPWhitelist.delete({
      where: { ipAddress: ip },
    });

    // Update local cache immediately
    whitelistedIPsCache.delete(ip);

    // Remove from Redis cache
    await deleteCachedEntry(ip);

    // Notify other instances via pub/sub
    await publishCacheUpdate({ action: 'remove', ip });

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_IP_REMOVE', 'IP_WHITELIST', ip, {});
    }

    logger.info('IP removed from whitelist', { ip, adminId });
  } catch (error) {
    if (error.code === 'P2025') {
      throw new Error(`IP address not in whitelist: ${ip}`);
    }
    throw error;
  }
}

// Get all whitelisted IPs
function getWhitelist() {
  return Array.from(whitelistedIPsCache.keys());
}

// Clear whitelist (use with caution)
async function clearWhitelist(adminId = null) {
  try {
    const ips = Array.from(whitelistedIPsCache.keys());

    await prisma.iPWhitelist.deleteMany({});
    
    // Update local cache immediately
    whitelistedIPsCache.clear();

    // Clear Redis cache keys in background
    if (redisReady(publisher)) {
      const keys = ips.map(ip => `${WHITELIST_CACHE_PREFIX}${ip}`);
      if (keys.length > 0) {
        publisher.del(...keys).catch(err => {
          logger.warn('Failed to clear Redis IP whitelist cache', { error: err.message });
        });
      }
    }

    // Notify other instances via pub/sub
    await publishCacheUpdate({ action: 'clear' });

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_CLEAR', 'IP_WHITELIST', 'ALL', { 
        clearedCount: ips.length 
      });
    }

    logger.info('IP whitelist cleared', { clearedCount: ips.length, adminId });
  } catch (error) {
    logger.error('Failed to clear whitelist', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Force reload of the whitelist from the database.
 * Useful for manual synchronization or recovery scenarios.
 */
async function reloadWhitelist() {
  try {
    cacheInitialized = false;
    whitelistedIPsCache.clear();
    await initializeCache();
    
    // Notify other instances to reload too
    await publishCacheUpdate({ action: 'reload' });
    
    logger.info('IP whitelist reloaded from database', { 
      count: whitelistedIPsCache.size 
    });
  } catch (error) {
    logger.error('Failed to reload whitelist', { error: error.message });
    throw error;
  }
}

/**
 * Clean up Redis connections gracefully.
 * Should be called during server shutdown.
 */
async function closeRedisConnections() {
  const promises = [];
  
  if (publisher) {
    promises.push(
      publisher.quit().catch(err => 
        logger.warn('Error closing IP whitelist Redis publisher', { error: err.message })
      )
    );
  }
  
  if (subscriber) {
    promises.push(
      subscriber.quit().catch(err => 
        logger.warn('Error closing IP whitelist Redis subscriber', { error: err.message })
      )
    );
  }
  
  await Promise.all(promises);
  publisher = null;
  subscriber = null;
  redisInit = null;
  
  logger.info('IP whitelist Redis connections closed');
}

export {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
  reloadWhitelist,
  initializeCache,
  closeRedisConnections,
  isValidIP,
  isIPInCIDR,
};

export default {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
  reloadWhitelist,
  initializeCache,
  closeRedisConnections,
  isValidIP,
  isIPInCIDR,
};
