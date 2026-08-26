import prisma from '../db/client.js';
import { logAdminAction } from '../db/adminAuditLog.js';
import logger from '../config/logger.js';

const whitelistedIPsCache = new Map();
let cacheInitialized = false;

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

// Initialize cache from database
async function initializeCache() {
  if (cacheInitialized) return;

  try {
    const entries = await prisma.iPWhitelist.findMany();
    entries.forEach(entry => {
      whitelistedIPsCache.set(entry.ipAddress, entry);
    });

    // Also load from environment variable for backward compatibility
    const envWhitelist = process.env.RATE_LIMIT_WHITELIST
      ? process.env.RATE_LIMIT_WHITELIST.split(',').map(ip => ip.trim())
      : [];

    for (const ip of envWhitelist) {
      if (isValidIP(ip) && !whitelistedIPsCache.has(ip)) {
        whitelistedIPsCache.set(ip, { ipAddress: ip, reason: 'Environment variable' });
      }
    }

    cacheInitialized = true;
    logger.info('IP whitelist cache initialized', {
      count: whitelistedIPsCache.size,
    });
  } catch (error) {
    logger.error('Failed to initialize IP whitelist cache', {
      error: error.message,
    });
  }
}

// Check if IP is whitelisted
function isWhitelisted(ip) {
  if (!ip) return false;
  return whitelistedIPsCache.has(ip);
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

    whitelistedIPsCache.set(ip, entry);

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_IP_ADD', 'IP_WHITELIST', ip, { reason });
    }

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

    whitelistedIPsCache.delete(ip);

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_IP_REMOVE', 'IP_WHITELIST', ip, {});
    }
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
    whitelistedIPsCache.clear();

    // Log to audit trail
    if (adminId) {
      await logAdminAction(adminId, 'WHITELIST_CLEAR', 'IP_WHITELIST', 'ALL', { clearedCount: ips.length });
    }
  } catch (error) {
    logger.error('Failed to clear whitelist', {
      error: error.message,
    });
    throw error;
  }
}

export {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
  initializeCache,
  isValidIP,
};

export default {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
  initializeCache,
  isValidIP,
};
