# frontend/components/TransactionHistory.jsx: Missing virtualized windowing causes DOM bloat and scroll stutter on active wallets

**Domain:** Frontend & Performance  
**Complexity:** Medium  
**Labels:** `performance`, `frontend`, `ui`  
**Issue ID:** ISSUE-178

---

## Background
In `frontend/src/components/TransactionHistory.jsx`:
All fetched transactions from the Stellar Horizon `/accounts/{id}/payments` endpoint are mapped directly to DOM `<div>` elements in a continuous list.

## Problem
- High-volume merchant or automated streaming accounts accumulate hundreds or thousands of transactions.
- Rendering 1,000+ complex transaction row items (each containing icons, copy buttons, status badges, formatted dates, and expandable details) creates over 20,000 DOM nodes.
- Mobile browsers experience severe scroll jank, input latency, and frequent browser tab memory crashes (`Out of Memory`).

## Proposed Solution
1. Integrate `react-window` or the project's existing `VirtualList.jsx` component into `TransactionHistory.jsx`.
2. Only render visible items currently within the viewport plus an overscan buffer of 5 items.
3. Implement infinite-scroll pagination (`useInfiniteQuery` or intersection observer) to fetch subsequent transaction pages from Horizon on demand.

## Implementation Steps
1. Refactor transaction list in `frontend/src/components/TransactionHistory.jsx` to use `VirtualList`.
2. Implement fixed or dynamic row height measurement.
3. Verify memory usage and 60 FPS scrolling performance with 2,000 simulated transactions.

## Acceptance Criteria
- [ ] DOM node count remains constant (<100 nodes) regardless of total transaction history size.
- [ ] Smooth 60 FPS scrolling on mobile and low-end desktop devices.
- [ ] Infinite scrolling smoothly loads older ledgers without UI freezing.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Essential for performance scalability in active accounts.

**GitHub Issue:** [1425](https://github.com/Ethereal-Future/FuTuRe/issues/1425)
