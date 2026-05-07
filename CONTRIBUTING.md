# Contributing to Supernote

Thank you for your interest in contributing. This document covers everything you need to get started.

## Prerequisites

- Node.js >= 22
- pnpm >= 11 (`npm install -g pnpm`)
- Git

## Quick start

```bash
# Clone the repo
git clone https://github.com/your-org/supernote.git
cd supernote

# Install all dependencies and build internal packages
pnpm install && pnpm setup

# Start the app in development mode (web + desktop)
pnpm dev
```

`pnpm dev` starts the Next.js dev server and the Electron shell concurrently. The desktop window opens automatically once the web server is ready on port 3000.

## Project structure

```
apps/
  web/        Next.js frontend
  desktop/    Electron shell
packages/
  db/         SQLite layer (Prisma + better-sqlite3)
  ipc/        IPC contract types shared between main and renderer
  ui/         Shared React components
docs/dev/     Developer documentation
```

For a deeper tour see [`docs/dev/architecture.md`](docs/dev/architecture.md).

## Running tests

```bash
# Unit + integration tests (all packages via Turborepo)
pnpm test

# Type checking
pnpm typecheck

# Lint
pnpm lint

# End-to-end tests (requires a display — use xvfb-run on Linux)
pnpm test:e2e
```

All tests must pass before a PR is merged. E2E tests are best-effort in CI (they run but a failure does not block merge).

## Commit style

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

Types: feat | fix | docs | style | refactor | test | chore | ci | perf
```

Examples:

```
feat(db): add full-text search index on entities
fix(desktop): prevent blank window on cold start
docs(contributing): update quick-start instructions
```

Breaking changes must include `BREAKING CHANGE:` in the commit body.

## Workflow

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`
2. Make your changes — **one feature = one focused PR**
3. Add or update tests for the changed behaviour
4. Run `pnpm test` and `pnpm typecheck` locally
5. Push your branch and open a pull request against `main`
6. Fill in the PR template; the CI will run automatically
7. Address review feedback; the PR will be merged once CI is green and it has a maintainer approval

## Adding a new feature

- Prefer editing existing files over creating new ones
- Keep functions under 20 lines; split into helpers if needed
- Use typed interfaces for all public module APIs
- Validate inputs at system boundaries (IPC handlers, API routes)
- New user-facing behaviour must come with at least one test

## Updating the database schema

See [`docs/dev/release.md`](docs/dev/release.md#migration-de-schéma-db) — all migrations must be additive.

## Releasing

Releases are managed by maintainers. See [`docs/dev/release.md`](docs/dev/release.md) for the full process. In short: bump versions, update `CHANGELOG.md`, tag `vX.Y.Z` on `main`, and push — GitHub Actions does the rest.

## Code of conduct

Be respectful and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
