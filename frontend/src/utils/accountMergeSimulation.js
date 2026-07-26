import apiClient from '../api/client.js';

/**
 * Base reserve for Stellar accounts (stroops)
 * @see https://developers.stellar.org/docs/learn/glossary/fees-and-payments#base-reserves
 */
const BASE_RESERVE_STROOPS = 5_000_000; // 0.5 XLM in stroops

/**
 * Simulate an account merge operation before execution
 * Fetches live account state and calculates expected XLM transfer
 *
 * @param {string} sourcePublicKey - Public key of the account to merge
 * @param {string} destinationPublicKey - Public key of the destination account
 * @returns {Promise<{
 *   valid: boolean,
 *   error: string | null,
 *   sourceAccount: object,
 *   xlmToTransfer: number,
 *   subentryCount: number,
 *   trustlines: array,
 *   offers: array,
 *   signers: array,
 *   blockedReasons: array,
 *   warning: string | null
 * }>}
 */
export async function simulateAccountMerge(sourcePublicKey, destinationPublicKey) {
  const result = {
    valid: false,
    error: null,
    sourceAccount: null,
    xlmToTransfer: null,
    subentryCount: 0,
    trustlines: [],
    offers: [],
    signers: [],
    blockedReasons: [],
    warning: null,
  };

  try {
    // Fetch source account details from backend
    const { data } = await apiClient.get(`/api/stellar/account/${sourcePublicKey}/merge-simulation`, {
      params: { destination: destinationPublicKey },
    });

    if (!data.account) {
      result.error = 'Failed to load account data';
      return result;
    }

    result.sourceAccount = data.account;

    // Extract trustlines (non-XLM balances)
    const trustlines = (data.account.balances || []).filter(
      (b) => b.asset_type !== 'native' && parseFloat(b.balance) > 0
    );
    result.trustlines = trustlines;

    // Extract offers
    const offers = data.offers || [];
    result.offers = offers;

    // Extract signers (excluding the master weight)
    const signers = (data.account.signers || []).filter(
      (s) => s.key !== sourcePublicKey
    );
    result.signers = signers;

    // Calculate subentry count for XLM calculation
    // subentries = trustlines + offers + non-master signers
    result.subentryCount = (trustlines.length || 0) + (offers.length || 0) + (signers.length || 0);

    // Calculate expected XLM transfer
    // Formula: (2 + subentry_count) * base_reserve
    const baseReserveXLM = BASE_RESERVE_STROOPS / 10_000_000; // Convert stroops to XLM
    const xlmRequired = (2 + result.subentryCount) * baseReserveXLM;

    // Get XLM balance
    const xlmBalance = data.account.balances.find((b) => b.asset_type === 'native');
    const xlmAmount = xlmBalance ? parseFloat(xlmBalance.balance) : 0;

    result.xlmToTransfer = Math.max(0, xlmAmount - xlmRequired);

    // Check for blocking conditions
    if (trustlines.length > 0) {
      result.blockedReasons.push(
        `Cannot merge account with positive trustlines. Remove ${trustlines.length} trustline(s) first.`
      );
    }

    if (offers.length > 0) {
      result.blockedReasons.push(
        `Cannot merge account with open DEX offers. Cancel ${offers.length} offer(s) first.`
      );
    }

    // Warnings (not blocking)
    if (signers.length > 0) {
      result.warning = `This account has ${signers.length} additional signer(s). ` +
        'Note that the master weight will be set to 0 and cannot be recovered.';
    }

    if (result.xlmToTransfer < 0) {
      result.warning = 'The account does not have enough XLM to cover reserve requirements.';
    }

    result.valid = result.blockedReasons.length === 0;
    return result;
  } catch (error) {
    result.error = error?.response?.data?.error ||
      error.message ||
      'Failed to simulate account merge';
    return result;
  }
}

/**
 * Format XLM stroops to XLM with proper decimals
 * @param {number} stroops
 * @returns {string}
 */
export function stroopsToXLM(stroops) {
  return (stroops / 10_000_000).toFixed(7).replace(/\.?0+$/, '');
}
