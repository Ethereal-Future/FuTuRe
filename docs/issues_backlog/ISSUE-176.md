# frontend/components/PathPayment.jsx: Missing maximum slippage and execution deadline exposes swaps to sandwich attacks

**Domain:** Frontend & AMM/DEX  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `stellar`, `amm`  
**Issue ID:** ISSUE-176

---

## Background
In `frontend/src/components/PathPayment.jsx`:
Path payments find payment routes via Horizon `/paths` and submit `pathPaymentStrictSend` or `pathPaymentStrictReceive` operations.

## Problem
- The UI does not provide a slippage tolerance selector (e.g. 0.5%, 1%, custom) or enforce a maximum transaction validity time-bound (`timebounds.maxTime`).
- On volatile markets or during network congestion:
  1. A transaction submitted without a strict deadline can sit in the transaction queue for hours.
  2. MEV bots and arbitrageurs can front-run the swap or sandwich the trade.
  3. The user receives vastly fewer tokens than quoted on the confirmation screen with no warning!

## Proposed Solution
1. Add slippage tolerance settings (0.1%, 0.5%, 1.0%, custom) to `PathPayment.jsx`.
2. Compute `destMin` (for strict-send) or `sendMax` (for strict-receive) with the exact user-selected slippage limit.
3. Automatically attach a 3-minute execution deadline (`timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 180 }`).
4. Display price impact warnings when slippage or price impact exceeds 2%.

## Implementation Steps
1. Add slippage control component to `PathPayment.jsx`.
2. Update transaction builder call to include calculated slippage bounds and 180s deadline.
3. Add visual price impact badge (green <1%, yellow 1-3%, red >3%).
4. Add test verifying slippage rejection when simulated price moves.

## Acceptance Criteria
- [ ] Users can customize slippage tolerance.
- [ ] Transactions automatically expire if not included in a ledger within 3 minutes.
- [ ] High price impact triggers prominent user warning.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Standard DeFi security protection against MEV and market volatility.

**GitHub Issue:** [1423](https://github.com/Ethereal-Future/FuTuRe/issues/1423)
