# PR Title: `feat: Add loading skeleton components to replace spinner-only states`

## Description
This pull request replaces the legacy, layout-shifting spinner-only loading states for **Account Balances** and **Transaction History** with custom loading skeleton components that match the exact shape of the content being loaded. This drastically improves the user experience by reducing layout shift.

## Key Changes
- **New Components**:
  - `SkeletonText`: Reusable placeholder for lines of text, with customizable count and line widths.
  - `SkeletonCard`: Custom block matching the structure of a transaction row.
  - `SkeletonBalance`: Custom rows matching the layout of the account balance rows.
- **Improved Accessibility**: Added `role="status"`, `aria-busy="true"`, and descriptive `aria-label` attributes to the new skeleton elements.
- **Styling**: Appended `.skeleton-block` and associated shimmers to support light and dark modes in `index.css`.
- **Integrations**:
  - Replaced balance checking loading spinner with `<SkeletonBalance>` in `App.jsx`.
  - Replaced transaction loading spinner and row loaders with `<SkeletonCard>` items in `TransactionHistory.jsx`.
- **Storybook Stories**: Added CSF stories for all variants in `Skeleton.stories.jsx`.

## Verification Instructions
1. Navigate to the branch `feat/loading-skeletons`.
2. Run Storybook: `npm run storybook`.
3. Check the **Components/Skeleton** section to inspect the `Text`, `Card`, and `Balance` variants in both Light and Dark mode.
4. Launch the app (`npm run dev`) and trigger balance updates and transaction history refreshes to verify layout alignment.
