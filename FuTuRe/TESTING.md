# Testing Documentation

This document outlines the testing strategy, procedures, and guidelines for the Stellar Remittance Platform.

## 1. Testing Strategy

Our goal is to ensure a reliable and secure remittance platform through a balanced testing approach:

- **Unit Tests**: Focus on individual functions, especially Stellar SDK wrappers, data formatters, and validation logic.
- **Integration Tests**: Verify that different parts of the system work together (e.g., API routes interacting with Stellar services).
- **Manual Testing**: Essential for UI/UX verification and final end-to-end flows on the Stellar Testnet.

## 2. Test Setup Procedures

We use **Vitest** as our primary testing framework due to its speed and compatibility with Vite.

### Installation
The testing infrastructure is already configured. You do not need to install anything further if you have run `npm install`.

### Running Tests
To run all tests (standard for CI):
```bash
npm test
```

To run tests in watch mode (best for development):
```bash
npx vitest
```

To run tests in watch mode:
```bash
npx vitest
```

## 3. Testing Best Practices

- **AAA Pattern**: Follow the **Arrange, Act, Assert** structure for all tests.
- **Isolation**: Each test should be independent. Do not rely on the state from a previous test.
- **Mocking**: Mock external API calls and Stellar network responses to keep tests fast and deterministic.
- **Descriptive Naming**: Test descriptions should clearly state the expected behavior (e.g., `should return balance for a valid Stellar address`).

## 4. Test Writing Guidelines

### File Naming & Location
All test files should use the `.test.js` or `.spec.js` suffix and be placed in a dedicated `tests/` directory at the root of each workspace to maintain a clean `src/` folder.
Example: `backend/tests/stellar.test.js`

### Basic Example (Unit Test)
```javascript
import { describe, it, expect } from 'vitest';
import { formatAmount } from './stellar-utils';

describe('formatAmount', () => {
  it('should format a number to 7 decimal places', () => {
    const result = formatAmount(10.5);
    expect(result).toBe('10.5000000');
  });
});
```

## 5. Test Data Management

- **Mocks**: Use the `vi.mock()` function from Vitest to simulate Stellar SDK responses.
- **Fixtures**: Store common test data (e.g., sample public keys) in a dedicated `tests/fixtures` directory if they are used across multiple tests.
- **Environment**: Use a `.env.test` file for test-specific configurations.

## 6. Troubleshooting Guide

- **Async Timeouts**: If a test involves a Stellar transaction, it might exceed the default timeout. Use `it('...', async () => { ... }, 10000)` to increase it.
- **Stellar SDK Errors**: Ensure you are not actually hitting the live network; most "Connection Refused" errors are due to missing mocks.
- **Port Conflicts**: If running integration tests that start the server, ensure you use a different port than the development server.

## 7. Contributor Checklist

Before submitting a Pull Request, please ensure:
- [ ] New code has corresponding unit tests where applicable.
- [ ] All existing tests pass (`npm test`).
- [ ] Manual verification has been performed on the local development environment.
- [ ] No sensitive keys or test account secrets are committed.
