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

## Creating a new ADR

1. Copy the [MADR template](https://raw.githubusercontent.com/adr/madr/main/template/adr-template.md).
2. Name the file `NNNN-short-title.md` (zero-padded, sequential).
3. Add an entry to the index table above.
4. Open a PR — ADRs are reviewed like code.
