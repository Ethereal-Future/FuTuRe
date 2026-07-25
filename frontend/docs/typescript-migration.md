# TypeScript Migration Plan

## Status

**Phase 1 complete** — `src/utils/` is fully typed (8 files, ~300 lines).

TypeScript is configured in strict mode with `allowJs: true` / `checkJs: false` so the remaining `.jsx`/`.js` files compile without errors while migration continues incrementally.

---

## Completed

| Layer | Files | Status |
|-------|-------|--------|
| `src/utils/` | `validateAmount`, `validateStellarAddress`, `errorMessages`, `errorLogger`, `formatBalance`, `searchHighlighter`, `animations`, `webVitals` | ✅ Converted to `.ts` |

---

## Remaining migration order (lowest risk → highest risk)

### Phase 2 — Design system (standalone, no business logic)
Convert `.jsx` → `.tsx` for files in `src/design-system/`:
`Button`, `Input`, `Modal`, `Badge`, `Card` (plus their `.stories.jsx` files).

Each component has clear props and no external API calls; adding `interface Props` is mechanical.

### Phase 3 — Custom hooks
Convert `src/hooks/*.js` to `.ts`. Hooks have explicit inputs/outputs and no JSX, making them straightforward candidates after the design system.

Priority order: `useMessages`, `useNetworkStatus`, `useExchangeRate`, `useWebSocket`, `useOfflineQueue`, `usePWA`, `useRTL`, `useCopy`, `useFileUpload`, `useFocusTrap`.

### Phase 4 — Store and context
Convert `src/store/` and `src/contexts/`:
- `reducer.js` → `reducer.ts` (type the action union)
- `AppStateContext.jsx` → `AppStateContext.tsx`
- `persistence.js` → `persistence.ts`
- `tabSync.js` → `tabSync.ts`
- `ThemeContext.jsx` → `ThemeContext.tsx`

Define a `State` interface in `reducer.ts` and propagate it through context so all consumers get typed state.

### Phase 5 — Leaf components (no children/complex props)
`Spinner`, `CopyButton`, `StatusMessage`, `NetworkBadge`, `NetworkStatusBanner`, `XLMInfoIcon`, `LanguageSelector`, `FileUpload`, `NotificationBell`.

### Phase 6 — Feature components
`TransactionHistory`, `PaymentConfirmationModal`, `QRCodeModal`, `QRScanner`, `ImportAccountForm`, `ConfirmSendDialog`, `FeeDisplay`, `InlineConfirmation`, `AccountCreatedCelebration`, `TxLookup`, `AddressBook`, `AccountSettings`, `NotificationPreferences`, `BackupSettings`.

### Phase 7 — Complex / data-heavy components
`AMMPoolBrowser`, `StreamPayment`, `PathPayment`, `ConvertWidget`, `AccountRecovery`, `MultiSigTransactions`, `KYCForm`, `ComplianceDashboard`.

### Phase 8 — App entry point
`App.jsx` → `App.tsx` (convert last; it imports everything above and benefits most from having upstream types settled).

---

## Guidelines for each conversion

1. Rename `.jsx` → `.tsx` (or `.js` → `.ts`).
2. Add `interface Props { ... }` for component props; use `React.FC<Props>` or the equivalent function signature.
3. Replace `prop-types` guards with TypeScript types and remove the `prop-types` import.
4. Run `npm run typecheck` after each file to catch issues early.
5. Do not silence errors with `@ts-ignore` — fix them or open a follow-up issue.

## Enabling stricter checks incrementally

Once all files in a phase are converted, enable `checkJs: true` (or remove `allowJs`) and tighten flags:

```json
"noUncheckedIndexedAccess": true,   // after Phase 4
"exactOptionalPropertyTypes": true  // after Phase 7
```

---

## CI

`npm run typecheck` (`tsc --noEmit`) runs in CI on every push and pull request (see `.github/workflows/test.yml`).
