// Known asset issuers per network.
// USDC testnet issuer: https://developers.stellar.org/docs/tokens/usdc
const ASSETS = {
  testnet: {
    USDC: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  mainnet: {
    USDC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
};

const isTestnet = process.env.STELLAR_NETWORK === 'testnet';
const network = isTestnet ? 'testnet' : 'mainnet';

/**
 * Returns the issuer public key for a supported non-native asset.
 * Falls back to ASSET_ISSUER env var for custom assets.
 */
export function getIssuer(assetCode) {
  return ASSETS[network][assetCode] ?? process.env.ASSET_ISSUER ?? null;
}

/** Returns the list of supported asset codes (including XLM). */
export const SUPPORTED_ASSETS = ['XLM', ...Object.keys(ASSETS[network])];
