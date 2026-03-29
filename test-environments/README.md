# Test Environment Configurations
#
# Each environment is defined as a JSON file in envs/.
# The registry.js module manages provisioning, isolation, monitoring, and cleanup.

## Environments

| Name        | Purpose                          | Network  |
|-------------|----------------------------------|----------|
| unit        | Unit tests — no external deps    | mock     |
| integration | Integration tests — real Express | testnet  |
| e2e         | End-to-end tests — full stack    | testnet  |
| performance | Load / benchmark tests           | testnet  |

## Usage

```js
import { provision, teardown, getEnv } from './test-environments/registry.js';

// Provision an environment
const env = await provision('integration');

// Use env.vars for process.env overrides
// Use env.id for isolation (unique per run)

// Cleanup when done
await teardown(env.id);
```

## CLI

```bash
# Provision
node test-environments/cli.js provision integration

# Status
node test-environments/cli.js status

# Cleanup all
node test-environments/cli.js cleanup
```

## Versioning

Environment configs are versioned via the `version` field in each `envs/*.json`.
The registry logs each provisioning event to `test-environments/data/history.json`.
