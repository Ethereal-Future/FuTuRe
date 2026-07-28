# Locale Files

This directory contains translation files for all supported languages in the Stellar Remittance Platform.

## Supported Locales

- `en.json` - English (source of truth)
- `es.json` - Spanish (Español)
- `he.json` - Hebrew (עברית)
- `ar.json` - Arabic (العربية)
- `fr.json` - French (Français)
- `pt.json` - Portuguese (Português)
- `zh.json` - Chinese (中文)

## Locale File Structure

All locale files must maintain the **exact same key structure** as `en.json`. This ensures:

1. **No missing translations** - All keys from English exist in every locale
2. **No orphaned translations** - No extra keys that don't exist in English
3. **Consistent UI** - All languages have translations for all features

## Adding New Translations

When adding new translatable strings:

1. Add the key-value pair to `en.json` first
2. Add the translated versions to ALL other locale files
3. Run the locale parity check: `npm run test:locale-parity`
4. Fix any missing or extra keys reported

## Automated Checks

### Locale Parity Check

A CI check runs automatically to ensure all locale files have matching keys:

```bash
npm run test:locale-parity
```

This will:
- ✅ Pass if all locales have the same keys as `en.json`
- ❌ Fail if any locale is missing keys or has extra keys

### Running Tests

The locale parity check is part of the main test suite:

```bash
npm test
```

## Key Naming Convention

Use dot notation for nested namespaces:

```json
{
  "namespace": {
    "key": "Translation"
  }
}
```

This becomes: `namespace.key`

## stellarErrors Namespace

The `stellarErrors` namespace contains error messages mapped from Stellar/Horizon result codes:

- `tx_*` - Transaction-level errors (e.g., `tx_bad_seq`, `tx_insufficient_balance`)
- `op_*` - Operation-level errors (e.g., `op_underfunded`, `op_no_trust`)

These are critical for user experience as they appear when transactions fail.

## Maintenance

When refactoring or removing features:

1. Remove keys from `en.json`
2. Remove the same keys from all other locale files
3. Verify with `npm run test:locale-parity`

## Troubleshooting

### "Missing keys" error

If a locale is missing keys:
1. Identify which keys are missing (shown in the error)
2. Copy the structure from `en.json`
3. Translate the values to the target language

### "Extra keys" error

If a locale has extra keys:
1. Identify which keys are extra (shown in the error)
2. Check if they were renamed in `en.json` (if so, update the translation under the new key name)
3. Remove genuinely orphaned keys that no longer exist

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/check-locale-parity.js` | Validates all locales match en.json key structure |
| `scripts/list-locale-diff.js` | Lists specific missing/extra keys for debugging |
| `scripts/fix-ar-locale.js` | Example cleanup script (remove extra keys) |
| `tests/i18n/locale-parity.test.js` | Vitest test suite for locale parity |
