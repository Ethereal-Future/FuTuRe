const whitelistedIPs = new Set();

const RATE_LIMIT_WHITELIST = process.env.RATE_LIMIT_WHITELIST
  ? process.env.RATE_LIMIT_WHITELIST.split(',').map(ip => ip.trim())
  : [];

RATE_LIMIT_WHITELIST.forEach(ip => whitelistedIPs.add(ip));

function isWhitelisted(ip) {
  if (!ip) return false;
  return whitelistedIPs.has(ip);
}

function addToWhitelist(ip) {
  if (!ip) return;
  whitelistedIPs.add(ip);
}

function removeFromWhitelist(ip) {
  if (!ip) return;
  whitelistedIPs.delete(ip);
}

function getWhitelist() {
  return Array.from(whitelistedIPs);
}

function clearWhitelist() {
  whitelistedIPs.clear();
}

export {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
};

export default {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
};
