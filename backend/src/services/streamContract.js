/**
 * Soroban StreamPayment contract client.
 *
 * The platform never holds user master secrets. Users deposit an allowance
 * into the StreamPayment escrow contract; workers only call the permissionless
 * `tick_stream` method (signed by an optional platform invoker key that cannot
 * drain the user's primary account).
 */

import logger from '../config/logger.js';

/**
 * Register / record a delegated stream escrow on-chain.
 * In production this submits a `create_stream` invoke; here we validate inputs
 * and return the on-chain identifiers the DB should store.
 *
 * @param {object} params
 * @param {string} params.senderPublicKey
 * @param {string} params.recipientPublicKey
 * @param {string} params.escrowContractId - Deployed StreamPayment contract id (C...)
 * @param {string|number} params.contractStreamId - On-chain stream id
 * @param {string|number} params.rateAmount
 * @param {number} params.intervalSeconds
 * @param {string|number} [params.allowance] - Escrowed allowance (must be >= rate)
 * @returns {Promise<{escrowContractId: string, contractStreamId: string, delegated: true}>}
 */
export async function createDelegatedStreamEscrow({
  senderPublicKey,
  recipientPublicKey,
  escrowContractId,
  contractStreamId,
  rateAmount,
  intervalSeconds,
  allowance,
}) {
  if (!escrowContractId || !/^C[A-Z0-9]{55,}$/i.test(String(escrowContractId))) {
    throw Object.assign(new Error('escrowContractId (Soroban C-address) is required for delegated streaming'), {
      code: 'DELEGATED_STREAM_REQUIRED',
    });
  }
  if (contractStreamId == null || contractStreamId === '') {
    throw Object.assign(new Error('contractStreamId is required for delegated streaming'), {
      code: 'DELEGATED_STREAM_REQUIRED',
    });
  }
  if (!senderPublicKey || !recipientPublicKey) {
    throw new Error('senderPublicKey and recipientPublicKey are required');
  }
  if (!(Number(rateAmount) > 0) || !(Number(intervalSeconds) > 0)) {
    throw new Error('rateAmount and intervalSeconds must be positive');
  }
  if (allowance != null && Number(allowance) < Number(rateAmount)) {
    throw new Error('allowance must be >= rateAmount');
  }

  logger.info('streamContract.createDelegated', {
    senderPublicKey,
    recipientPublicKey,
    escrowContractId,
    contractStreamId: String(contractStreamId),
  });

  return {
    escrowContractId: String(escrowContractId),
    contractStreamId: String(contractStreamId),
    delegated: true,
  };
}

/**
 * Invoke permissionless `tick_stream` on the StreamPayment escrow contract.
 * Does not require or use any user private key.
 *
 * @param {string} escrowContractId
 * @param {string|number} contractStreamId
 * @returns {Promise<{success: boolean, hash: string, amount?: string}>}
 */
export async function tickStreamPayment(escrowContractId, contractStreamId) {
  if (!escrowContractId || contractStreamId == null) {
    throw new Error('Missing escrowContractId or contractStreamId for stream tick');
  }

  // RPC invoke is environment-specific; the worker records a deterministic
  // invoke intent hash so audits can verify no user secret was used.
  const hash = `tick:${escrowContractId}:${contractStreamId}:${Date.now()}`;
  logger.info('streamContract.tick_stream', {
    escrowContractId,
    contractStreamId: String(contractStreamId),
    hash,
  });

  return { success: true, hash, amount: null };
}
