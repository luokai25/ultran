# Contributing to Ultran

## Before you start

Read [`docs/architecture.md`](docs/architecture.md). The layered design is not
decorative: dependencies point downward only, and a change that crosses a layer
boundary needs an ADR before it needs code.

## The one rule that matters

**Nothing causes a side effect outside the tool sandbox.** If you find yourself
calling `fetch`, opening a file for writing, or spawning a process anywhere in
`orchestrator/` or `brain/`, stop - that belongs behind a capability grant in
`sandbox/`.

## Workflow

1. Fork, or branch from `main`:
   - `feat/<scope>` - new capability
   - `fix/<scope>` - bug fix
   - `docs/<scope>` - documentation only
   - `chore/<scope>` - tooling, deps, CI
2. Keep commits conventional: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
3. Run the gate locally before pushing:

   ```bash
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```

4. Open a PR describing **what changed and which layer it touches**. PRs that
   change a layer contract must link the ADR.

## Adding a connector

1. Create the manifest under `packages/connectors/src/builtin/`.
2. Declare the *minimum* capabilities your tools need. Declaring an unused
   capability is a validation error, by design.
3. List every host you will ever contact. Wildcards are rejected.
4. Run `validateManifest` - the build will do it for you, but failing locally
   is faster.

## Adding an ADR

Append a row to the decision log at the end of `docs/architecture.md`:

| ID | Decision | Rationale |
| --- | --- | --- |

One sentence each. If the rationale needs a paragraph, the decision is not yet
clear enough to record.

## Code style

- TypeScript strict mode is non-negotiable; `any` needs a comment justifying it.
- Prefer `type` over `interface` for unions and function signatures.
- No default exports outside Next.js and Expo route files.
- Comment *why*, never *what*.

## Security

Do not open public issues for vulnerabilities. Use
[private vulnerability reporting](https://github.com/luokai25/ultran/security/advisories/new).
