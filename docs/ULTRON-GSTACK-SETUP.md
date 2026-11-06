# ULTRON gstack setup

ULTRON has a repository-native gstack workflow so the project rules travel with the codebase.

## Installed in this repository

- `.agents/skills/ultron-gstack/SKILL.md`: product-to-production workflow adapted from gstack.
- `.agents/skills/ultron-design/SKILL.md`: ULTRON-specific design implementation and verification workflow.
- `docs/ULTRON-SCREEN-COVERAGE.md`: page, overlay and state coverage ledger.
- `AGENTS.md`: requires the workflow for substantial product/design/engineering work.
- `DESIGN.md`: links the design system, workflow and coverage ledger.

This repository-native integration is the authoritative ULTRON customization. It does not depend on Claude-only hooks, a global home-directory install or gstack's private runtime state.

## Optional upstream gstack runtime for Codex CLI

The upstream gstack repository documents Codex CLI as an **experimental** host. Its setup installs the upstream skill set into the local Codex skills directory; it does not replace ULTRON's project-specific skills.

Prerequisites:
- Git
- Bun v1.4.2 or newer
- Codex CLI installed and working

Run in the local development environment where Codex CLI is installed:

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/gstack
cd ~/gstack
./setup --host codex
./setup --status
```

The Codex install is placed under `${CODEX_HOME:-~/.codex}/skills/`. Check the status output rather than assuming registration succeeded. See the upstream [README](https://github.com/garrytan/gstack) and [host notes](https://github.com/garrytan/gstack/blob/main/docs/hosts.md) for current prerequisites and host limitations.

## ULTRON-specific guardrails

- Keep ULTRON's project-native skills enabled even when upstream gstack is installed.
- ULTRON's `AGENTS.md` and security constraints take precedence over generic upstream workflow defaults.
- Work only on the existing `main` branch. Do not create feature branches, open pull requests or force-push.
- Do not let a generic ship workflow publish a production deployment or release without the owner's explicit direction.
- Do not weaken Supabase RLS, approvals, connector scopes, credential handling or Android permission boundaries.
- Treat upstream setup status, skill registration and actual skill usage as separate facts. Verify each independently.
- Never claim the upstream runtime is installed unless the local `./setup --status` output confirms it.

## Why the upstream runtime is optional

The gstack source contains host-specific setup scripts, hooks and browser tooling. A GitHub repository edit cannot register those binaries into the owner's local Codex home directory. The repository-native ULTRON workflow is already committed and available to coding agents that load this repository's `.agents/skills` and `AGENTS.md`.
