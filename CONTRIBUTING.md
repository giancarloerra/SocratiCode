# Contributing to SocratiCode

Thank you for your interest in contributing to SocratiCode! This document explains the process for contributing and what to expect.

## Contributor License Agreement

By submitting a pull request, you agree to the [Contributor License Agreement (CLA)](CLA.md). This is necessary because SocratiCode is dual-licensed (AGPL-3.0 + commercial). The CLA allows us to offer commercial licenses that include community contributions.

## Getting Started

### Prerequisites

- Node.js 18.17 or newer for the server runtime
- Node.js 20.19 or newer in 20.x, 22.12 or newer in 22.x, or 24 and newer for tests
- Node.js 22 or newer for extension packaging
- Docker (for integration and E2E tests)
- Git

Release tools and strict root development installs (`npm ci --engine-strict`) require Node.js
22.22.2+ in 22.x, 24.15+ in 24.x, or 26+.

### Setup

```bash
git clone https://github.com/giancarloerra/socraticode.git
cd socraticode
npm install
npm run build
```

### Running Tests

```bash
# Unit tests (no Docker needed)
npm run test:unit

# Integration tests (requires Docker)
npm run test:integration

# End-to-end tests (requires Docker)
npm run test:e2e

# All tests
npm test

# Type checking
npx tsc --noEmit
```

See the [Developer Guide](DEVELOPER.md) for architecture details, data flows, and how the test infrastructure works.

## How to Contribute

### Reporting Bugs

Use the [Bug Report](https://github.com/giancarloerra/socraticode/issues/new?template=bug_report.yml) issue template. Include:

- Steps to reproduce
- Expected vs actual behaviour
- Your environment (OS, Node.js version, embedding provider, MCP host)
- Log output if available (set `SOCRATICODE_LOG_LEVEL=debug`)

### Suggesting Features

Use the [Feature Request](https://github.com/giancarloerra/socraticode/issues/new?template=feature_request.yml) issue template. Explain the problem you're trying to solve and your proposed approach.

### Submitting Pull Requests

1. **Fork** the repository and create a branch from `main`
2. **Make your changes** — follow the existing code style and conventions
3. **Add tests** — new functionality needs test coverage; bug fixes should include a regression test
4. **Update documentation** — if your changes affect the public API, update README.md and/or DEVELOPER.md
5. **Verify** — run `npm run lint && npx tsc --noEmit && npm run test:unit`
6. **Open a PR** — fill out the pull request template; use a draft while the implementation is still changing

### Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) to auto-generate the changelog:

```
feat: add fuzzy search support
fix: resolve race condition in watcher
docs: update quickstart guide
refactor: simplify provider factory
test: add watcher edge-case tests
chore: update dependencies
```

Prefix with the type, then a short imperative description. Use `feat:` for new features, `fix:` for bug fixes, and `chore:` for maintenance that doesn't need a changelog entry.

### What Makes a Good PR

- **Focused** — one logical change per PR
- **Tested** — unit tests at minimum; integration tests for infrastructure changes
- **Documented** — JSDoc comments on public functions, README/DEVELOPER.md updates where needed
- **Clean history** — squash fixup commits before requesting review
- **Conventional commits** — use the format above so the changelog generates correctly

## Code Style

- **TypeScript** with strict mode enabled
- **ESM** (ES modules) — use `.js` extensions in imports
- **Functional style** — prefer pure functions, avoid classes where unnecessary
- **Structured logging** — use `logger.info/warn/error/debug` with context objects, not `console.log`
- **Error messages** — user-friendly, actionable, include troubleshooting hints
- **JSDoc** on all exported functions
- **SPDX license header** on all source files:
  ```typescript
  // SPDX-License-Identifier: AGPL-3.0-only
  // Copyright (C) 2026 Giancarlo Erra - Altaire Limited
  ```

## Project Structure

```
src/services/   — Core business logic (docker, indexer, embeddings, etc.)
src/tools/      — MCP tool handlers (one file per tool group)
src/config.ts   — Project ID and collection naming
src/constants.ts — All configurable constants
tests/unit/     — Unit tests (no Docker)
tests/integration/ — Integration tests (Docker required)
tests/e2e/      — End-to-end tests (Docker required)
```

See [DEVELOPER.md](DEVELOPER.md) for the full architecture overview.

## Review Process

- All PRs are reviewed by a maintainer
- Maintainers first confirm that a PR is in scope and stable enough for technical review
- [CodeRabbit](https://coderabbit.ai) reviews a PR after a maintainer applies the `review-ready` label
- After review findings, batch related fixes before requesting another review; maintainers trigger follow-up reviews against a stable head
- Address or resolve all applicable CodeRabbit comments before requesting final human approval
- CI must pass (tests + type checking)
- One approval required to merge
- Maintainers may request changes or suggest alternatives

## Questions?

- Open a [Discussion](https://github.com/giancarloerra/socraticode/discussions) for questions
- Check the [README](README.md) and [Developer Guide](DEVELOPER.md) for existing documentation

Thank you for helping make SocratiCode better!
