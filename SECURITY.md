# Security Policy

## Supported Versions

FuTuRe is developed on a single rolling `main` branch with continuous deployment — there are no maintained release branches or LTS versions. Security fixes are applied to `main` and deployed forward; there is no backporting to older commits or tags.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for a security vulnerability.** Public issues are appropriate for bugs and feature requests, not for live vulnerabilities that could be exploited before a fix ships — especially given this platform handles Stellar keypairs and financial transactions.

Report vulnerabilities privately via **[GitHub Security Advisories](https://github.com/Ethereal-Future/FuTuRe/security/advisories/new)** (repo → Security tab → "Report a vulnerability"). This opens a private disclosure thread with maintainers, separate from public issues and PRs, and lets us coordinate a fix and disclosure timeline before details become public.

> Private vulnerability reporting must be enabled at the repository-admin level (Settings → Security → "Private vulnerability reporting") for the link above to work. If it appears unavailable, treat that as a follow-up to raise with a maintainer rather than a blocker on this document — see the Notes on the originating issue for this file.

Include as much of the following as you can:

- The affected component/file and, if applicable, the endpoint or flow (e.g. JWT refresh-token rotation, a Stellar transaction-building path).
- Steps to reproduce, or a proof of concept.
- The potential impact (data exposure, fund loss, privilege escalation, etc.).
- Any suggested remediation, if you have one.

## Response Expectations

- **Acknowledgement:** within 3 business days of a report.
- **Initial assessment** (severity, affected scope): within 7 business days.
- **Fix timeline:** communicated once the report is triaged — critical issues (e.g. anything affecting fund safety or key handling) are prioritized ahead of the normal PR queue, per [CONTRIBUTING.md § Applying a security patch](CONTRIBUTING.md#applying-a-security-patch).

We'll credit reporters in the advisory/release notes unless you ask to stay anonymous.

## Existing Security Documentation

This file covers *how to report* a vulnerability. For everything else security-related in this repo:

- **[CONTRIBUTING.md § Dependency Vulnerability Management](CONTRIBUTING.md#dependency-vulnerability-management)** — how `npm audit` / Dependabot alerts are triaged and patched.
- **[CONTRIBUTING.md § Docker Image Scanning (Trivy)](CONTRIBUTING.md#docker-image-scanning-trivy--issue-772)** — CVE scanning on container images, failure thresholds, and how to suppress a false positive via `.trivyignore`.
- **[CONTRIBUTING.md § Renovate](CONTRIBUTING.md#renovate-automated-dependency-updates--issue-773)** — automated dependency updates, including security-flagged updates.
- **[docs/guides/security.md](docs/guides/security.md)** — security guidance for developers *integrating with or building on* the platform (API key storage, CSRF/webhook verification, CSP, private key management, known attack vectors). This is integrator-facing guidance, not a disclosure process — if you find a vulnerability while reading it, report it using the process above rather than opening an issue against the guide.

This platform's threat model around key handling and the auth flow is documented in [docs/adr/0001-stellar-blockchain.md](docs/adr/0001-stellar-blockchain.md) and [docs/adr/0004-auth-approach.md](docs/adr/0004-auth-approach.md), which may be useful context when writing up a report.
