# ADR-0002: Use Prisma as the ORM

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-01-15

## Context and Problem Statement

The backend needs to interact with a PostgreSQL database for user records, transactions, payment streams, multi-sig pending transactions, and compliance data. We need to choose between a query builder, a full ORM, or raw SQL to manage schema migrations, type safety, and maintainability.

## Decision Drivers

* Schema migrations must be version-controlled and reproducible
* TypeScript/JS type safety on query results to reduce runtime errors
* Developer ergonomics: readable queries without hand-written SQL for every operation
* Must support connection pooling and PgBouncer transaction-pooling mode
* Must support soft-delete patterns and complex relational queries

## Considered Options

* **Prisma** — schema-first ORM with auto-generated types, Prisma Migrate, and official PgBouncer adapter
* **Knex.js** — SQL query builder with migrations, no type generation
* **Drizzle ORM** — newer schema-first ORM with full TypeScript inference, minimal abstraction
* **Raw `pg`** — maximum control, zero overhead, but no migrations or type safety out of the box

## Decision Outcome

Chosen option: **Prisma**, because it provides the best balance of type safety, migration tooling, and team familiarity at this stage of the project.

Prisma's schema-first approach (`schema.prisma`) makes the data model the single source of truth. Prisma Migrate generates SQL migration files that are committed to the repo and run automatically on startup. The `@prisma/adapter-pg` driver adapter gives us first-class PgBouncer support (prepared-statement-free transaction pooling) without extra configuration. The generated Prisma Client eliminates an entire class of runtime query-shape errors.

### Positive Consequences

* Type-safe queries and results without writing type annotations by hand
* Migration history is version-controlled alongside code
* PgBouncer support via official adapter — no hacks required
* Soft-delete middleware and relation includes are idiomatic in Prisma
* Large ecosystem, good documentation, active community

### Negative Consequences

* Prisma abstracts SQL, which can make complex query optimisation harder to reason about
* Prisma Client generation step adds ~2–5 seconds to cold installs in CI
* Heavy migration (millions of rows) may require `prisma db execute` with raw SQL instead of Prisma Migrate

## Pros and Cons of the Options

### Knex.js

* Good, because lightweight and gives full SQL control
* Good, because migration system is battle-tested
* Bad, because no type generation — query results typed as `any`
* Bad, because more boilerplate for relational queries

### Drizzle ORM

* Good, because fully TypeScript-native with excellent type inference
* Good, because closer to raw SQL — easier to optimise
* Bad, because ecosystem is younger; fewer examples and community answers at project start
* Bad, because migration tooling (Drizzle Kit) was less mature than Prisma Migrate when this decision was made

### Raw `pg`

* Good, because zero abstraction overhead
* Good, because full SQL expressiveness
* Bad, because no migration framework — must build one or adopt a standalone tool
* Bad, because no type generation — high risk of shape mismatches between query and application code
