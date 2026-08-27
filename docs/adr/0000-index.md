# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the FuTuRe remittance platform.

ADRs follow the [MADR](https://adr.github.io/madr/) (Markdown Architectural Decision Records) template.

## Index

| ID | Title | Status |
|---|---|---|
| [ADR-0001](0001-stellar-blockchain.md) | Use Stellar as the blockchain layer | Accepted |
| [ADR-0002](0002-prisma-orm.md) | Use Prisma as the ORM | Accepted |
| [ADR-0003](0003-caching-strategy.md) | Multi-level caching: in-memory L1 + Redis L2 | Accepted |
| [ADR-0004](0004-auth-approach.md) | JWT-based authentication with refresh token rotation | Accepted |
| [ADR-0005](0005-monorepo-structure.md) | npm workspaces monorepo structure | Accepted |

## Creating a new ADR

1. Copy [`docs/adr/template.md`](template.md) to `NNNN-short-title.md` (zero-padded, sequential — see the comment at the top of the template for details).
2. Fill in every section of the template.
3. Add an entry to the index table above.
4. Open a PR — ADRs are reviewed like code.

The template is a lighter, repo-specific subset of the upstream [MADR template](https://adr.github.io/madr/), trimmed to match the structure actually used by the ADRs in this directory.
