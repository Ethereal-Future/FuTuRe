# ISSUE-253 (#1567): NetworkStatusBanner has a stray import and a duplicate component

**Area:** Frontend & Architecture · **Complexity:** Low
**File:** `frontend/src/components/NetworkStatusBanner.jsx`

## Summary

The file contains two versions of the component that were merged badly. The first `NetworkStatusBanner` stops partway through its JSX `return`. Right after it, at about line 33, come `import` statements and a second `export function NetworkStatusBanner`. This is a syntax error, so `vite build` fails and the frontend bundle cannot be produced.

## Current structure

```
L1    import { memo } from 'react';
L4-21 latency constants, latencyLevel(), LatencyIndicator (memo)
L23   export function NetworkStatusBanner({ status }) {   // version A: prop-driven
L28     return (
L29-32    <div ...> ... <LatencyIndicator ... />           // JSX never closed
L33   import { useState } from 'react';                    // stray import
L34   import { useNetworkStatus } from '../hooks/useNetworkStatus';
L47   export function NetworkStatusBanner() {              // version B: hook-driven, duplicate name
```

There are two separate errors: an `import` is not allowed inside a function body or JSX, and the same exported name is declared twice.

## Remediation

1. Move every `import` to the top of the file.
2. Keep one `NetworkStatusBanner`. Version B (hook-driven) has the newer behaviour: polling every 30 s, dismissal, the max-fee setting, and fee-surge and degraded states. Merge version A's `LatencyIndicator` into it so the latency display is kept.
3. Delete the unfinished version A.
4. Check every call site (`grep -rn "NetworkStatusBanner" frontend/src`). Any caller that passes a `status` prop must either stop passing it, or the component must accept an optional `status` that overrides the hook. Choose one approach and update the existing tests or snapshots to match.

## Acceptance criteria

- [ ] `npm run build --workspace=frontend` succeeds.
- [ ] The banner shows the connected, offline, degraded and fee-surge states correctly.
- [ ] The latency indicator still shows good, warning, critical and timeout levels.
- [ ] The file has exactly one `NetworkStatusBanner` export.

## Prevention

Run `npm run build --workspace=frontend` (or at least `eslint`) as a required CI check, so a file that does not parse cannot be merged.
