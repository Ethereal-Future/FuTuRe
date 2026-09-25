/**
 * Canonical Stellar configuration module.
 *
 * Exports a shared `horizonServer` instance and `networkPassphrase` string
 * derived from the application config (getConfig().stellar).  All service
 * modules that previously imported these values from a non-existent path now
 * import from here, resolving ISSUE-044 (ERR_MODULE_NOT_FOUND crashes).
 *
 * The `horizonServer` export is a lazily-evaluated getter backed by the same
 * cached-instance logic as `getHorizonServer()` in services/stellar.js, so
 * config hot-reloads (URL changes) are automatically reflected.
 *
 * NOTE: Do not import `horizonServer` at module-evaluation time in tests;
 * mock this module with vi.mock('../config/stellar.js') when the Horizon
 * network is not available.
 */

import * as StellarSDK from '@stellar/stellar-sdk';
import { getConfig } from './env.js';

// ── Horizon server (cached, auto-refreshes on URL change) ─────────────────────

let _horizonServerUrl;
let _horizonServer;

/**
 * Return a cached Horizon.Server instance, recreating it when the configured
 * URL changes (e.g. after a hot-config reload).
 * @returns {import('@stellar/stellar-sdk').Horizon.Server}
 */
function resolveHorizonServer() {
  const { horizonUrl } = getConfig().stellar;
  if (!_horizonServer || horizonUrl !== _horizonServerUrl) {
    _horizonServerUrl = horizonUrl;
    _horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
  }
  return _horizonServer;
}

/**
 * Lazily-evaluated Horizon server proxy.
 * Consumers can call it directly as a function (resolveHorizonServer()) or
 * use the named export `horizonServer` as a plain object — because most
 * callers access it as `horizonServer.loadAccount(...)`, the Proxy approach
 * lets existing service code work without changes while still picking up URL
 * changes at call time.
 */
export const horizonServer = new Proxy(
  {},
  {
    get(_target, prop) {
      const server = resolveHorizonServer();
      const value = server[prop];
      // Bind methods so `this` points to the real server instance
      return typeof value === 'function' ? value.bind(server) : value;
    },
  }
);

// ── Network passphrase ────────────────────────────────────────────────────────

/**
 * The Stellar network passphrase for the currently configured network
 * (`testnet` → `StellarSDK.Networks.TESTNET`, anything else → `PUBLIC`).
 * Re-evaluated on every access so it tracks live config changes.
 * @type {string}
 */
export const networkPassphrase = new Proxy(
  { value: null },
  {
    get(_target, prop) {
      if (prop === 'toString' || prop === Symbol.toPrimitive || prop === 'valueOf') {
        // Support string coercion (e.g. template literals or direct comparisons)
        const passphrase =
          getConfig().stellar.network === 'testnet'
            ? StellarSDK.Networks.TESTNET
            : StellarSDK.Networks.PUBLIC;
        return () => passphrase;
      }
      // Direct property access — return the resolved string
      const passphrase =
        getConfig().stellar.network === 'testnet'
          ? StellarSDK.Networks.TESTNET
          : StellarSDK.Networks.PUBLIC;
      return passphrase[prop];
    },
  }
);

/**
 * Eagerly resolve and return the current network passphrase string.
 * Use this when you need a plain `string` value (e.g. TransactionBuilder).
 * @returns {string}
 */
export function getNetworkPassphrase() {
  return getConfig().stellar.network === 'testnet'
    ? StellarSDK.Networks.TESTNET
    : StellarSDK.Networks.PUBLIC;
}
