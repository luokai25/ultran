# ULTRON gstack setup

ULTRON uses two layers:

1. **Repository-native ULTRON skills**, which travel with the project and define the product-specific rules.
2. **Upstream gstack**, which provides its design, engineering-review, QA and browser workflow tooling when installed in a local Codex environment.

## Installed in this repository

- `.agents/skills/ultron-gstack/SKILL.md`: product-to-production workflow adapted from gstack.
- `.agents/skills/ultron-design/SKILL.md`: ULTRON-specific design implementation and verification workflow.
- `docs/ULTRON-SCREEN-COVERAGE.md`: page, overlay and state coverage ledger.
- `AGENTS.md`: requires the workflow for substantial product/design/engineering work.
- `DESIGN.md`: gstack-compatible design specification with machine-readable tokens and ULTRON page inventory.

These repository-native files are the authoritative ULTRON customization. They do not depend on Claude-only hooks or global home-directory state.

## Upstream gstack for Codex CLI

The upstream gstack repository documents Codex as an experimental host. Its setup installs upstream skills and browser/design binaries into the local Codex skills directory; it does not replace ULTRON's project-specific instructions.

Prerequisites:
- Git
- Bun v1.4.2 or newer
- Codex CLI installed and working

Run from the ULTRON repository root in the local development environment where Codex CLI is installed:

```bash
./scripts/setup-gstack-codex.sh
```

The script clones or fast-forwards a clean upstream checkout at `~/.local/share/gstack` (override with `GSTACK_DIR`), installs the Codex skill set, prints the install registry and runs `gstack-doctor`. It refuses to overwrite a modified checkout. To pin a different upstream ref, set `GSTACK_REF` explicitly.

The Codex install is placed under `${CODEX_HOME:-~/.codex}/skills/`. Check both `./setup --status` and `bin/gstack-doctor` output rather than assuming registration succeeded. Codex support is experimental upstream; host-specific warnings must be reported rather than hidden.

See the upstream [README](https://github.com/garrytan/gstack), [host notes](https://github.com/garrytan/gstack/blob/main/docs/hosts.md), and [install details](https://github.com/garrytan/gstack/blob/main/docs/install.md) for current requirements and limitations.

## ULTRON-specific guardrails

- Keep `.agents/skills/ultron-gstack` and `.agents/skills/ultron-design` enabled even when upstream gstack is installed.
- ULTRON's `AGENTS.md`, `DESIGN.md`, security constraints and screen-coverage ledger take precedence over generic upstream workflow defaults.
- Work only on the existing `main` branch. Do not create feature branches, open pull requests or force-push.
- Do not let a generic ship workflow publish a production deployment or release without the owner's explicit direction.
- Do not weaken Supabase RLS, approvals, connector scopes, credential handling or Android permission boundaries.
- Treat upstream setup status, skill registration and actual skill usage as separate facts. Verify each independently.
- Never claim the upstream runtime is installed unless the local `./setup --status` output confirms it.

## How ULTRON uses gstack

For a substantial redesign, use the upstream equivalents when available:

- Product framing and requirements: `/office-hours` and `/plan-ceo-review`.
- Design consultation and design-plan review: `/design-consultation` and `/plan-design-review`.
- Design system and rendered-page review: `/design-review` and `/design-html`.
- Engineering and code review: `/plan-eng-review` and `/review`.
- Browser QA and regression investigation: `/qa`, `/qa-only` and `/investigate`.
- Retrospective: `/retro`.

The ULTRON wrapper skills translate those methods into the project's architecture and hard constraints. The upstream runtime is optional for agents that already have equivalent browser, code-review and test tools.
