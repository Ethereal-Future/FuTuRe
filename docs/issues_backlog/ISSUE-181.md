# frontend/components/AccountMerge.jsx: Missing confirmation and account-existence check allows irreversible fund destruction

**Domain:** Frontend & Stellar Safety  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `data-loss`  
**Issue ID:** ISSUE-181

---

## Background
In `frontend/src/components/AccountMerge.jsx`:
The account merge operation irreversibly merges the current Stellar account into a destination account, transferring all remaining native lumens and permanently deleting the source account from the ledger.

## Problem
- The component does not verify whether the destination account exists on-chain before building the operation.
- If the destination account has not been funded or if a user inputs a non-existent address:
  - Stellar protocol allows merging into an uncreated account ONLY if it transfers >= minimum reserve (1 XLM), creating it.
  - However, if the destination address contains a typo or points to a smart contract address that cannot be controlled, the source account is permanently destroyed and all remaining funds are lost forever!
- There is no double-confirmation dialog or requirement to type "MERGE" to confirm.

## Proposed Solution
1. Check destination account status via Horizon before allowing submission.
2. Display prominent high-risk modal warning in red: "This action is permanent and cannot be undone. Your current account will be permanently deleted from the Stellar ledger."
3. Require the user to type the word "MERGE" and confirm the destination address checksum before enabling the merge button.

## Implementation Steps
1. Add pre-flight Horizon account existence check in `AccountMerge.jsx`.
2. Implement high-friction confirmation modal requiring text confirmation.
3. Add tests verifying button disabled until exact confirmation word is typed.

## Acceptance Criteria
- [ ] Account merge requires typing explicit confirmation text.
- [ ] Destination address is verified on Horizon before proceeding.
- [ ] Prominent warning alerts user that account deletion is irreversible.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Crucial guardrail against catastrophic accidental account destruction.

**GitHub Issue:** [1428](https://github.com/Ethereal-Future/FuTuRe/issues/1428)
