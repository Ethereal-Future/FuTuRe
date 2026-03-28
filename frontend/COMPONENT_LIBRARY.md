# Component Library — Usage Guidelines

**Version:** 1.0.0  
**Location:** `frontend/src/design-system/`

---

## Quick Start

```jsx
import { Button, Badge, Card, Input, Modal } from '../design-system';
```

---

## Design Tokens

Tokens live in `tokens.js` and mirror the CSS custom properties in `index.css`.  
Use CSS variables in stylesheets; use the JS tokens only when you need values in JS (e.g. dynamic styles, tests).

```js
import { tokens } from '../design-system';
// tokens.color.primary → 'var(--primary)'
// tokens.space.lg      → '16px'
```

---

## Components

### Button

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'danger' \| 'ghost'` | `'primary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Padding/font size |
| `loading` | `boolean` | `false` | Shows spinner, disables interaction |
| `fullWidth` | `boolean` | `false` | Stretches to container width |
| `disabled` | `boolean` | `false` | Disables interaction |

```jsx
<Button variant="primary" onClick={handleSend}>Send Payment</Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button loading>Sending…</Button>
```

**Do:**
- Use `primary` for the single main action per screen
- Use `secondary` for cancel/back actions
- Always provide meaningful text (avoid "Click here")

**Don't:**
- Stack multiple `primary` buttons side by side
- Use `danger` for anything reversible

---

### Badge

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'success' \| 'danger' \| 'warning' \| 'info'` | `'default'` | Color scheme |

```jsx
<Badge variant="success">Confirmed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="info">Testnet</Badge>
```

**Do:** Use to communicate status at a glance.  
**Don't:** Use for interactive elements — badges are display-only.

---

### Card

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `header` | `ReactNode` | — | Optional header slot |
| `footer` | `ReactNode` | — | Optional footer slot |
| `padding` | `'sm' \| 'md' \| 'lg'` | `'md'` | Body padding |

```jsx
<Card header="Account Balance" footer="Last updated: just now">
  1,234.56 XLM
</Card>
```

---

### Input

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | — | Visible label (required for a11y) |
| `id` | `string` | auto | Ties label to input |
| `error` | `string` | — | Error message; sets `aria-invalid` |
| `hint` | `string` | — | Helper text (hidden when error is shown) |
| `fullWidth` | `boolean` | `false` | |

```jsx
<Input
  label="Recipient Address"
  placeholder="G…"
  error={errors.address}
  hint="Must be a valid Stellar public key"
/>
```

**Always provide a `label`** — it's required for screen reader accessibility.

---

### Modal

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | — | Controls visibility |
| `onClose` | `() => void` | — | Called on ESC, overlay click, or close button |
| `title` | `string` | — | Dialog title (used for `aria-labelledby`) |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Max width |

```jsx
<Modal open={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Transfer">
  <p>Send 50 XLM to GXXX…?</p>
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
    <Button variant="secondary" onClick={() => setShowConfirm(false)}>Cancel</Button>
    <Button onClick={handleConfirm}>Confirm</Button>
  </div>
</Modal>
```

---

## Theming

The app supports `light` and `dark` themes via CSS custom properties.  
Use `useTheme()` from `contexts/ThemeContext` to read or toggle the theme.  
Never hardcode color values — always use `var(--token-name)`.

---

## Versioning

The component library follows **semver**:

- **Patch** (1.0.x) — bug fixes, style tweaks, no API changes
- **Minor** (1.x.0) — new components or props, fully backward-compatible
- **Major** (x.0.0) — breaking prop renames, removed components, or CSS class changes

The current version is exported from `tokens.js`:
```js
import { COMPONENT_VERSION } from '../design-system/tokens';
```

When making breaking changes, update `COMPONENT_VERSION` and add a migration note here.

---

## Storybook

```bash
cd frontend
npm run storybook        # dev server on http://localhost:6006
npm run build-storybook  # static build → storybook-static/
```

Stories live alongside components: `Button.stories.jsx`, `Badge.stories.jsx`, etc.

---

## Adding a New Component

1. Create `frontend/src/design-system/MyComponent.jsx`
2. Add CSS to `index.css` under the `DESIGN SYSTEM` section
3. Export from `index.js`
4. Add `MyComponent.stories.jsx`
5. Add tests to `frontend/tests/design-system.test.jsx`
6. Document it in this file
