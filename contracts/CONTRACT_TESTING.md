# Contract Testing

Consumer-driven contract testing using [Pact](https://pact.io) between the frontend (consumer) and backend (provider).

## Structure

```
contracts/
├── consumer/               # Consumer contract tests (frontend expectations)
│   └── stellar-api.consumer.test.js
├── provider/               # Provider verification tests (backend)
│   └── stellar-api.provider.test.js
├── pacts/                  # Generated pact files (committed to repo)
│   └── FuTuRe-Frontend-FuTuRe-Backend.json
├── logs/                   # Contract version snapshots
├── registry.js             # Versioning & breaking change detection
├── registry.test.js        # Registry unit tests
└── CONTRACT_TESTING.md     # This file
```

## Contracts Defined

| Consumer | Provider | Interactions |
|---|---|---|
| FuTuRe-Frontend | FuTuRe-Backend | `POST /api/stellar/account/create` |
| FuTuRe-Frontend | FuTuRe-Backend | `GET /api/stellar/account/:publicKey` |
| FuTuRe-Frontend | FuTuRe-Backend | `POST /api/stellar/payment/send` |
| FuTuRe-Frontend | FuTuRe-Backend | `GET /health` |

## Workflow

### 1. Consumer generates contracts
```bash
npm run test:contracts:consumer
```
This runs the consumer tests and writes pact files to `contracts/pacts/`.

### 2. Provider verifies contracts
```bash
npm run test:contracts:provider
```
This starts the real Express app and verifies every interaction in the pact files.

### 3. Run all contract tests
```bash
npm run test:contracts
```

### 4. Publish a version snapshot
```js
import { publishVersion } from './contracts/registry.js';
publishVersion('FuTuRe-Frontend', 'FuTuRe-Backend');
```

### 5. Detect breaking changes
```js
import { detectBreakingChanges } from './contracts/registry.js';
const breaks = detectBreakingChanges('FuTuRe-Frontend', 'FuTuRe-Backend', 1, 2);
if (breaks.length) console.error('Breaking changes:', breaks);
```

## CI/CD

Contract tests run automatically on every PR via `.github/workflows/contracts.yml`:
1. Consumer tests run first and generate pact files.
2. Provider verification runs against the generated pacts.
3. Breaking change detection compares the new pact against the last published version.
4. The workflow fails if any breaking changes are detected.

## Adding New Contracts

1. Add an interaction in `contracts/consumer/stellar-api.consumer.test.js`.
2. Add the corresponding state handler in `contracts/provider/stellar-api.provider.test.js`.
3. Run consumer tests to regenerate the pact file.
4. Run provider verification to confirm the backend satisfies the new interaction.
