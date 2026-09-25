import * as StellarSDK from '@stellar/stellar-sdk';

/**
 * In-process per-account sequence coordinator.
 *
 * This serializes sequence allocation per source account so concurrent
 * transaction builders never reuse the same sequence number.
 */
class SequenceManager {
  constructor() {
    this.queueByAccount = new Map();
    this.stateByAccount = new Map();
  }

  async withLock(sourcePublicKey, task) {
    const prior = this.queueByAccount.get(sourcePublicKey) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    this.queueByAccount.set(sourcePublicKey, tail);

    await prior;
    try {
      return await task();
    } finally {
      release();
      if (this.queueByAccount.get(sourcePublicKey) === tail) {
        this.queueByAccount.delete(sourcePublicKey);
      }
    }
  }

  clear(sourcePublicKey) {
    this.stateByAccount.delete(sourcePublicKey);
  }

  async getAccountForBuild(sourcePublicKey, loadAccountFn) {
    const state = this.stateByAccount.get(sourcePublicKey);
    if (state?.lastAllocatedSequence) {
      const account = new StellarSDK.Account(
        sourcePublicKey,
        state.lastAllocatedSequence.toString(),
      );
      return {
        account,
        balances: Array.isArray(state.balances) ? state.balances : [],
        fromCache: true,
      };
    }

    const loaded = await loadAccountFn();
    const currentSequence = BigInt(loaded.sequenceNumber());
    this.stateByAccount.set(sourcePublicKey, {
      lastAllocatedSequence: currentSequence,
      balances: loaded.balances ?? [],
    });
    return { account: loaded, balances: loaded.balances ?? [], fromCache: false };
  }

  markBuilt(sourcePublicKey, account, balances = []) {
    this.stateByAccount.set(sourcePublicKey, {
      lastAllocatedSequence: BigInt(account.sequenceNumber()),
      balances: Array.isArray(balances) ? balances : [],
    });
  }
}

export const sequenceManager = new SequenceManager();
