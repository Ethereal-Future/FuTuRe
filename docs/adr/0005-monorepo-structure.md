# ADR-0005: npm Workspaces Monorepo, with Rust and Contract-Test Code Outside the JS Tree

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-08-26

## Context and Problem Statement

The platform is split across a Node.js/Express backend, a React frontend, Pact consumer/provider contract tests, and a Soroban (Rust) smart contract. We need a repository layout that lets the backend and frontend share tooling (lint, test, CI) and iterate together, without forcing the Rust smart contract or the API contract tests into a structure that doesn't fit them.

## Decision Drivers

* Backend and frontend change together frequently (shared API contracts, shared release cadence) and benefit from a single `npm install` and shared root-level tooling (ESLint, Prettier, Vitest, Husky/lint-staged).
* The Soroban smart contract (`stellar-contract/`) is a Rust/Cargo project with its own toolchain, build artifacts (WASM), and release lifecycle — it is deployed on-chain independently of any backend deploy, and the backend only ever talks to it over Soroban RPC using a contract ID, never as a build/runtime dependency.
* Pact contract tests (`contracts/`) validate the request/response shape between backend and frontend and need to be runnable from the same Vitest/CI setup as the rest of the JS code, but are not an installable package consumed by either workspace.
* Avoid the operational overhead of managing multiple repositories (cross-repo versioning, coordinated releases, duplicated CI config) for a team of this size.
* Avoid adopting a heavier monorepo tool (Turborepo, Nx) before the workspace count or build-graph complexity justifies it.

## Considered Options

* **npm workspaces** — native to npm 7+, zero extra tooling, hoists shared `node_modules`, `backend`/`frontend` declared in the root `package.json`
* **Separate repositories** — one repo per deployable (backend, frontend, contract)
* **Turborepo / Nx** — dedicated monorepo build orchestrators with task caching and dependency graphs

## Decision Outcome

Chosen option: **npm workspaces**, with `backend/` and `frontend/` as the only two workspace packages, and `contracts/` (Pact tests) and `stellar-contract/` (Soroban contract) kept as plain top-level directories outside the workspace array.

The root `package.json` declares:

```json
"workspaces": ["backend", "frontend"]
```

This gives the two JS packages a shared `node_modules`, a single lockfile, and root-level scripts (`npm run dev`, `npm run test:coverage`, `npm run lint`) that fan out to both with `--workspace=<name>` or `--workspaces`. `contracts/` is not a workspace — it has no `package.json` of its own and is exercised directly by the root Vitest config (`vitest.contracts.config.js`) against `contracts/consumer`, `contracts/provider`, and `contracts/registry.test.js`. `stellar-contract/` is not part of the npm dependency graph at all: it is a self-contained Cargo project (`Cargo.toml`/`Cargo.lock`) compiled to WASM and deployed to the Stellar network independently, and the backend only ever reaches it over Soroban RPC at runtime (see `backend/src/routes/stellar/contract.js` and the `SOROBAN_RPC_URL` config in `backend/src/config/env.js`) — there is no build-time coupling that would justify pulling it into the npm workspace tree.

### Positive Consequences

* Single `npm install` and single lockfile for both JS packages; no version drift between backend and frontend's shared devDependencies (ESLint, Prettier, Vitest).
* Root-level CI jobs (lint, test, coverage) run once against both workspaces instead of per-repo pipelines.
* The Rust toolchain (`cargo build`, `cargo test`) stays fully decoupled from `npm install` — contributors who never touch the smart contract never need Rust installed, and vice versa.
* Pact tests live alongside the code whose contract they verify, without needing to be an installable package.

### Negative Consequences

* A single `npm install` failure (e.g. a bad transitive dependency) can block work on both backend and frontend simultaneously, where separate repos would isolate the failure.
* `stellar-contract/` and `contracts/` are easy to confuse by name alone — see the disambiguation note below.
* New contributors must understand that "the monorepo" does not mean "everything lives in one dependency graph" — `stellar-contract/` needs a separate `cargo build` step documented outside of `npm run dev`.

## Naming Disambiguation: `contracts/` vs `stellar-contract/`

These two top-level directories serve unrelated purposes despite the similar names:

| Directory | What it is | Language/toolchain | Runs via |
|---|---|---|---|
| `contracts/` | Pact consumer/provider **API contract tests** — verify that backend and frontend agree on request/response shapes | JavaScript (Vitest) | `npm run test:contracts` |
| `stellar-contract/` | The Soroban **smart contract** (on-chain prediction market program) | Rust (Cargo, Soroban SDK) | `cargo build` / `cargo test` inside `stellar-contract/`; deployed to the Stellar network separately from any npm script |

If you are looking for blockchain/smart-contract code, you want `stellar-contract/`. If you are looking for API request/response contract tests between backend and frontend, you want `contracts/`.

## Pros and Cons of the Options

### Separate Repositories

* Good, because failures and CI in one package can't block another
* Good, because access control and release cadence can differ per package
* Bad, because a single backend+frontend API change requires coordinating two PRs across two repos
* Bad, because shared devDependencies (ESLint, Prettier, Vitest config) drift out of sync without extra tooling
* Bad, because contributors need multiple clones and multiple `npm install`s for a single feature that touches both sides

### Turborepo / Nx

* Good, because remote build caching and a dependency graph pay off as the number of packages grows
* Good, because task orchestration (`affected` builds/tests) scales better than plain npm scripts once there are many packages
* Bad, because it adds a new tool and config surface for a monorepo that currently has only two JS workspace packages
* Bad, because the Rust and Pact-test directories would still sit outside its build graph, so it wouldn't remove the disambiguation problem — only add tooling overhead not yet justified by scale
