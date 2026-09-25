# services/stellar.js: createAccount and fundAccount lack network isolation guards between testnet Friendbot and mainnet execution

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `security`, `backend`  
**Issue ID:** ISSUE-022

---

## Background
In `backend/src/services/stellar.js`, `fundAccount` checks `if (!isTestnet()) throw new Error('Only available on testnet')` (line 196). However, in `createAccount` (lines 209-270):
```javascript
export async function createAccount(correlationId = null) {
...
  const keypair = StellarSDK.Keypair.random();
  const publicKey = keypair.publicKey();
  const secretKey = keypair.secret();
  
  if (isTestnet()) {
    await fundAccount(publicKey);
  }
...
```

## Problem
- If the server is configured with `STELLAR_NETWORK=mainnet` or `futurenet`, `createAccount` creates the keypair but silently skips funding.
- On Stellar mainnet, an unfunded account does not exist on the ledger (minimum 1 XLM reserve required to exist on-chain).
- The function persists the unfunded account in the database and returns it to the client as an active account. Subsequent operations (e.g. trustline creation, payments) immediately fail with `op_no_destination` or `account_not_found`.
- Furthermore, there is no verification that `process.env.STELLAR_NETWORK` matches the `networkPassphrase` configured on Horizon Server.

## Proposed Solution
Explicitly handle account creation workflows per network: on mainnet, require account creation to specify a sponsor or funding account that executes a `createAccount` operation with the required base reserve. Add a startup validation check that queries Horizon `/` and asserts that `passphrase` reported by the Horizon server strictly matches `getConfig().stellar.network`.

## Implementation Steps
1. Add network handshake on startup in `backend/src/server.js` verifying Horizon passphrase matches configured environment.
2. Update `createAccount` to require platform funding or explicit sponsor key when running on mainnet.
3. Mark unfunded accounts with a distinct database status `PENDING_ACTIVATION` until the on-chain creation transaction confirms.
4. Add tests verifying network passphrase consistency checks.

## Acceptance Criteria
- [ ] Server aborts boot if configured network does not match Horizon server passphrase.
- [ ] Mainnet account creation handles minimum reserve funding or marks account as pending.
- [ ] Unfunded accounts are not presented as active accounts in the UI.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1269](https://github.com/Ethereal-Future/FuTuRe/issues/1269)
