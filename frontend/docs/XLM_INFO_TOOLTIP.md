# XLM Info Tooltip Feature

## Overview
This feature adds an informational tooltip icon next to all visible "XLM" labels throughout the application to help new users understand what XLM is and why it's important in the Stellar network.

## Implementation Details

### Component: `XLMInfoIcon`
Location: `frontend/src/components/XLMInfoIcon.jsx`

A reusable, accessible tooltip component that displays information about XLM (Lumens) when users interact with it.

#### Features
- **Accessible**: Full keyboard navigation support (Enter, Space, Escape)
- **Mobile-friendly**: Touch-optimized with proper tap targets (44x44px minimum)
- **Responsive**: Adapts to different screen sizes
- **Non-intrusive**: Doesn't interfere with form inputs or layout
- **Consistent**: Uses existing design system tokens and styles

#### Props
- `className` (optional): Additional CSS classes for custom styling

#### Behavior
- Click/tap to toggle tooltip visibility
- Press Enter or Space to open when focused
- Press Escape to close and return focus to button
- Click outside to close
- Supports touch events for mobile devices

### Integration Points

The XLM info icon has been integrated in the following locations:

1. **Balance Display** (`App.jsx`)
   - Shows next to XLM asset in balance list
   - Only appears for XLM, not other assets

2. **Payment Form** (`App.jsx`)
   - Helper text below amount input field
   - Provides context for new users entering amounts

3. **KYC Warning Message** (`App.jsx`)
   - Appears in large transaction warning
   - Helps users understand the currency context

4. **Confirmation Dialog** (`ConfirmSendDialog.jsx`)
   - Shows next to XLM amounts in payment summary
   - Appears in amount, fee, and total fields

### Styling

CSS classes added to `frontend/src/index.css`:

- `.xlm-info-wrapper`: Container for the icon and tooltip
- `.xlm-info-btn`: The info button styling
- `.xlm-tooltip`: Tooltip popup styling
- Responsive breakpoints for mobile (480px, 320px)

### Accessibility Features

- **ARIA attributes**:
  - `aria-label`: Descriptive label for screen readers
  - `aria-expanded`: Indicates tooltip state
  - `aria-describedby`: Links button to tooltip content
  - `role="tooltip"`: Semantic role for assistive technologies

- **Keyboard navigation**:
  - Tab to focus the button
  - Enter/Space to toggle
  - Escape to close and return focus

- **Focus management**:
  - Visible focus indicators
  - Focus returns to button after closing
  - Proper tab order maintained

- **Touch targets**:
  - Minimum 44x44px on mobile
  - Adequate spacing to prevent mis-taps

## Testing

### Unit Tests
Location: `frontend/tests/XLMInfoIcon.test.jsx`

Covers:
- Rendering and display states
- Tooltip show/hide behavior
- Keyboard navigation (Enter, Space, Escape)
- Click outside behavior
- Touch events for mobile
- ARIA attributes and accessibility
- Animation behavior
- Multiple instances
- Edge cases and cleanup

### Integration Tests
Location: `frontend/tests/XLMInfoIcon.integration.test.jsx`

Covers:
- Balance display integration
- Payment form integration
- KYC warning integration
- Keyboard navigation flow
- Form submission compatibility
- Layout and spacing preservation

### Running Tests

```bash
# Run all tests
npm test

# Run XLM info icon tests only
npm test -- XLMInfoIcon

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Browser Compatibility

Tested and compatible with:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Considerations

- Tooltip uses `AnimatePresence` from Framer Motion for smooth animations
- Event listeners are properly cleaned up on unmount
- Click outside detection uses efficient event delegation
- No performance impact on form submission or validation

## Future Enhancements

Potential improvements:
- Add i18n support for tooltip content
- Allow customization of tooltip position
- Add analytics tracking for tooltip interactions
- Support for additional currencies (USDC, etc.)

## Maintenance

When updating:
- Ensure ARIA attributes remain correct
- Test keyboard navigation after changes
- Verify mobile touch targets
- Run full test suite
- Check visual regression tests

## Related Files

- Component: `frontend/src/components/XLMInfoIcon.jsx`
- Styles: `frontend/src/index.css` (search for "XLM Info Icon")
- Tests: `frontend/tests/XLMInfoIcon.test.jsx`
- Integration: `frontend/tests/XLMInfoIcon.integration.test.jsx`
- Usage: `frontend/src/App.jsx`, `frontend/src/components/ConfirmSendDialog.jsx`
