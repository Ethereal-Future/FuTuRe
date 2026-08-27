# Stellar / Horizon Error Reference

The backend talks to Stellar's Horizon API for account creation, balance queries, payments, and trustline management (see [ADR-0001](../adr/0001-stellar-blockchain.md)). This page catalogues the Horizon/Stellar error codes this codebase actually anticipates — the canonical list lives in code at [`backend/src/utils/stellarErrors.js`](../../backend/src/utils/stellarErrors.js) (`STELLAR_ERROR_MAP`), which maps each code to a user-facing message and a `retryable` flag. This doc explains *why* each error happens and what to do about it during development; the code decides what the API actually returns.

An error code not in the map falls through to a generic "unrecognized network error" (non-retryable) and logs `stellarErrors.unmappedCode` — if you hit that during development, it means Horizon returned something new; add it to `STELLAR_ERROR_MAP` rather than working around it ad hoc (see [#953](https://github.com/Ethereal-Future/FuTuRe/issues/953)).

## How errors reach the app

`extractStellarErrorCode()` pulls the code out of the raw Horizon error: transaction-level codes from `error.data.extras.result_codes.transaction`, operation-level codes from `result_codes.operations[0]`, or a synthetic code (`connection_error`, `timeout`, `rate_limit`, `tx_failed`) derived from the HTTP status/error name for network-level failures. `getStellarErrorInfo()` then looks that code up in the map. If you're debugging a raw Horizon error object, this is the function to trace through.

## Sequence numbers (`tx_bad_seq`)

**Cause:** every Stellar transaction must include a sequence number exactly one greater than the account's last committed transaction. `sendPayment()` in `backend/src/services/stellar.js` fetches the current sequence via `loadAccount()` immediately before building the transaction — `tx_bad_seq` means the on-chain sequence had already advanced by the time the transaction was submitted, most often because:

- Two requests for the same account were in flight concurrently (e.g. rapid double-click on "Send", or two backend instances handling requests for the same account at once).
- A previous transaction from the same account succeeded on-chain but the response was lost/delayed, and the client retried the *original* transaction rather than rebuilding with a fresh sequence number.

**Fix:** the codebase already marks this `retryable: true`. Rebuild the transaction (re-fetch the account via `loadAccount()` to get the current sequence) rather than resubmitting the same signed transaction — a stale sequence number will never succeed on retry. If you're seeing this frequently in local testing, check for duplicate submit calls (e.g. a form re-firing on double submit) rather than assuming it's a network flake.

## Minimum balance reserve (`op_low_reserve`, and underfunded payments generally)

**Cause:** every Stellar account must maintain a minimum XLM reserve (base reserve × number of subentries — trustlines, offers, signers — plus a base amount), enforced by the network itself. A payment, trustline creation, or offer that would drop the source account below that reserve is rejected outright, even if the account's balance looks nonzero.

This trips up local testing specifically because Friendbot funds a *fixed* amount (10,000 test XLM — see [README.md § Friendbot](../../README.md#friendbot)) but reserve requirements grow with how many trustlines/offers/signers the account accumulates. A freshly-funded account with several trustlines and open offers can fail a payment that looks like it should succeed based on raw balance.

**Fix:** when testing payments, check `getBalance()`'s output against the account's actual reserve requirement, not just against the payment amount — leave headroom, or fund a fresh account instead of reusing one that's accumulated a lot of subentries. See `op_low_reserve` in `STELLAR_ERROR_MAP` for the exact user-facing message.

## `op_underfunded`

**Cause:** the payment amount itself exceeds the source account's *available* balance (balance minus reserve minus amount needed to cover the transaction fee) — distinct from `op_low_reserve`, which is about what's left *after* the operation, not whether the operation itself is affordable.

**Fix:** non-retryable by design — a balance shortfall doesn't resolve itself by resubmitting. Reduce the payment amount or fund the account further (Friendbot on testnet).

## `op_no_destination`

**Cause:** the destination account doesn't exist on the network yet. Unlike some blockchains, Stellar accounts must be explicitly created (funded with at least the minimum reserve) before they can receive most operations.

**Fix:** on testnet, fund the destination via Friendbot first (`scripts/fund-testnet-account.sh`, see [scripts/README.md](../../scripts/README.md#fund-testnet-accountsh)). On mainnet, the destination needs a real minimum-reserve XLM balance from somewhere before it can receive a payment — this is a real user-facing error case, not just a test-environment quirk. Note `sendPayment()` doesn't currently validate the destination exists before submitting, so this surfaces as a Horizon rejection rather than a pre-flight check.

## `op_no_trust`

**Cause:** you're sending a non-XLM asset to an account that hasn't established a trustline for that asset. Trustlines are Stellar's opt-in mechanism for holding non-native assets — an account can't receive USDC (or any issued asset) until it explicitly authorizes holding it, via `createTrustline()`.

**Fix:** the recipient must create a trustline for the asset (asset code + issuer) before you can pay them in it. This is not something the sender can work around — it's the recipient's responsibility to opt in.

## `op_line_full`

**Cause:** the destination account's trustline has a limit (set via `createTrustline()`/`updateTrustlineLimit()`), and the incoming payment would push their balance of that asset above that limit.

**Fix:** the recipient needs to raise their trustline limit (`updateTrustlineLimit()`) before they can receive more of the asset.

## `tx_insufficient_fee`

**Cause:** the transaction's fee is below the network's current minimum, most often during a fee surge (network congestion). `sendPayment()` builds transactions with `StellarSDK.BASE_FEE`, which is the network's baseline minimum, not a fee that automatically adapts to congestion.

**Fix:** marked `retryable: true`. Check `getNetworkStatusWithFeeSurge()` in `backend/src/services/stellar.js` for current surge pricing and consider `wrapWithFeeBump()` (also in that file) to bump the fee of an already-submitted transaction rather than resubmitting from scratch.

## `tx_too_late` / `tx_too_early`

**Cause:** `sendPayment()` sets a 30-second submission window (`setTimeout(30)` on the transaction builder). `tx_too_late` means the transaction wasn't included in a ledger before that window closed — usually a slow network or a delayed submission after signing. `tx_too_early` means the transaction was submitted before its `minTime` bound, which shouldn't normally happen with this codebase's transaction-building path unless a caller passes a custom time bound.

**Fix:** both `retryable: true` — rebuild and resubmit (which also refreshes the sequence number, see above).

## Client-side malformed-address validation

`op_malformed` covers operations Horizon itself rejects as structurally invalid (bad asset codes, malformed operation parameters). Malformed *destination addresses* specifically (wrong length, invalid checksum) should be caught client-side before ever reaching Horizon — validate against the Stellar public-key format (`G` followed by 55 base32 characters, same check `scripts/fund-testnet-account.sh` applies) rather than relying on a round-trip to Horizon to discover a typo.

## See also

- [`backend/src/utils/stellarErrors.js`](../../backend/src/utils/stellarErrors.js) — the source-of-truth error map and code that produces these errors.
- [docs/guides/dependency-upgrades.md § `@stellar/stellar-sdk`](dependency-upgrades.md#stellarstellar-sdk) — Horizon error *shapes* can change across SDK majors; that's covered as an upgrade-risk item there, not here.
- [README.md § Testnet Setup](../../README.md#testnet-setup) — Friendbot funding and testnet vs. mainnet configuration.
