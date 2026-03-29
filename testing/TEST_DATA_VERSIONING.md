# Test Data Versioning

This document describes the test data versioning system used in the FuTuRe project.

## Overview

Test data versioning ensures consistent and reproducible test environments across different stages of development and testing.

## Versioning Strategy

### Semantic Versioning for Test Data

Test data follows semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes to test data structure or schema
- **MINOR**: New test data additions or non-breaking changes
- **PATCH**: Bug fixes or minor updates to existing test data

### Version Files

Test data versions are stored in:
- `test-data/versions/` - Versioned test data snapshots
- `test-data/current/` - Current active test data
- `test-data/fixtures/` - Reusable test fixtures

## Creating a New Version

### 1. Create a Snapshot

```bash
node testing/seed-data.js snapshot create v1.0.0
```

This creates a snapshot of the current test data state.

### 2. Tag the Version

```bash
git tag -a test-data-v1.0.0 -m "Test data version 1.0.0"
git push origin test-data-v1.0.0
```

### 3. Document Changes

Update `test-data/versions/CHANGELOG.md` with:
- What changed
- Why it changed
- Migration instructions (if needed)

## Restoring a Version

### Restore from Snapshot

```bash
node testing/seed-data.js snapshot restore v1.0.0
```

### Reset to Latest Version

```bash
node testing/seed-data.js reset
```

## Version Management Commands

### List All Versions

```bash
node testing/seed-data.js version list
```

### Create New Version

```bash
node testing/seed-data.js version create <version> <description>
```

### Compare Versions

```bash
node testing/seed-data.js version compare <version1> <version2>
```

### Delete Version

```bash
node testing/seed-data.js version delete <version>
```

## Best Practices

### 1. Version Before Major Changes

Always create a version before making significant changes to test data structure.

### 2. Document Breaking Changes

If you make breaking changes, document:
- What broke
- How to migrate
- Why the change was necessary

### 3. Keep Versions Small

Create focused versions for specific features or fixes rather than large monolithic versions.

### 4. Test Version Restores

Regularly test that version restores work correctly.

### 5. Use Descriptive Names

Use clear, descriptive version names and descriptions.

## Version Structure

```
test-data/
├── versions/
│   ├── v1.0.0/
│   │   ├── accounts.json
│   │   ├── transactions.json
│   │   └── metadata.json
│   ├── v1.1.0/
│   │   ├── accounts.json
│   │   ├── transactions.json
│   │   └── metadata.json
│   └── CHANGELOG.md
├── current/
│   ├── accounts.json
│   └── transactions.json
└── fixtures/
    ├── account.json
    ├── transaction.json
    └── payment.json
```

## Metadata Format

Each version includes a `metadata.json` file:

```json
{
  "version": "1.0.0",
  "description": "Initial test data version",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "createdBy": "test@example.com",
  "changes": [
    {
      "type": "added",
      "description": "Added 10 test accounts"
    },
    {
      "type": "modified",
      "description": "Updated transaction schema"
    }
  ],
  "schema": {
    "accounts": 10,
    "transactions": 200
  }
}
```

## Migration Guide

### Migrating from v1.0.0 to v1.1.0

1. Backup current data:
   ```bash
   node testing/seed-data.js snapshot create pre-migration
   ```

2. Restore target version:
   ```bash
   node testing/seed-data.js snapshot restore v1.1.0
   ```

3. Run migrations (if needed):
   ```bash
   node testing/migrate-data.js v1.0.0 v1.1.0
   ```

4. Verify data:
   ```bash
   node testing/seed-data.js status
   ```

## Troubleshooting

### Version Restore Failed

**Problem**: Version restore fails with data inconsistency

**Solution**:
1. Check if database is clean
2. Verify version exists
3. Check for schema conflicts
4. Review error logs

### Missing Version

**Problem**: Version not found in version list

**Solution**:
1. Check `test-data/versions/` directory
2. Verify version was created successfully
3. Check git tags for version history

### Data Corruption

**Problem**: Test data appears corrupted after restore

**Solution**:
1. Restore from backup
2. Re-seed database
3. Create new version

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Data Setup

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  setup-test-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Setup test database
        run: |
          npm run db:migrate
          node testing/seed-data.js seed
      
      - name: Run tests
        run: npm test
```

## Version History

See `test-data/versions/CHANGELOG.md` for detailed version history.
