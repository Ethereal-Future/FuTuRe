# frontend/App.jsx: Monolithic 2,450-line component causes catastrophic re-render cascades and state fragmentation

**Domain:** Frontend & Architecture  
**Complexity:** Hard  
**Labels:** `enhancement`, `frontend`, `performance`, `refactor`  
**Issue ID:** ISSUE-171

---

## Background
In `frontend/src/App.jsx`:
The root `App.jsx` file contains over 2,450 lines of code. It directly holds dozens of `useState` variables for unrelated domains (active tab, payment amounts, QR scanner visibility, biometric credentials, address book, notification modal, stellar account balances, exchange rates, and transaction history).

## Problem
- Any state update (e.g. typing a character in the recipient field, a live balance update, or an exchange rate tick) triggers a full re-render of the entire 2,450-line component tree.
- Complex child components (TransactionBuilder, StreamPayment, ChartsDashboard, VirtualList) re-evaluate their render logic repeatedly.
- Input lag, frame drops during animations, and state synchronization bugs occur frequently when multiple async operations complete simultaneously.
- Code maintainability is severely compromised; multiple feature branches frequently encounter git merge conflicts in `App.jsx`.

## Proposed Solution
1. Refactor `App.jsx` into modular domain views using React Router or dedicated feature pages (`pages/Wallet`, `pages/Payments`, `pages/Streaming`, `pages/Settings`, `pages/Compliance`).
2. Lift domain state into React Context providers (`WalletProvider`, `ExchangeRateProvider`, `NotificationProvider`) or modular Zustand/Redux slices.
3. Wrap expensive child components with `React.memo` and optimize callback stability with `useCallback` and `useMemo`.

## Implementation Steps
1. Decompose `App.jsx` into sub-pages under `frontend/src/pages/`.
2. Create dedicated Context providers for wallet and payment workflows.
3. Replace top-level monolithic state with localized state hooks.
4. Measure render performance using React DevTools Profiler to ensure zero unnecessary child re-renders.

## Acceptance Criteria
- [ ] `App.jsx` is reduced to under 300 lines serving as the layout router shell.
- [ ] Typing in input fields causes only the targeted input component to re-render.
- [ ] Zero merge conflict hotspots across disparate feature teams.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Essential architectural refactor for frontend performance and scalability.

**GitHub Issue:** [1418](https://github.com/Ethereal-Future/FuTuRe/issues/1418)
