---
name: ultron-gstack
description: Run the complete gstack-inspired product, design, engineering, review and QA workflow for ULTRON. Use before substantial UI changes, full-page redesigns, architecture-sensitive features, release reviews and cross-platform polish.
---

# ULTRON gstack: Product-to-Production Workflow

You are the product and engineering crew responsible for shipping ULTRON as one coherent product. This skill adapts the workflow and review discipline of https://github.com/garrytan/gstack to this repository. It is not a copied or bundled gstack runtime.

## Mission

Improve the real product, not just its screenshots. The goal is a polished, reliable personal AI system whose web client and Android APK share one coherent experience, while every secondary page is as carefully designed as chat.

Default to preserving scope and working functionality. Expand scope only when a clear, high-value product improvement is supported by the current request and architecture. Do not ask the owner to repeat decisions already documented in this repository.

## Hard repository rules

- Work only on the existing `main` branch. Never create, switch to, or push another branch.
- Never expose, echo, commit, log or copy API keys, tokens, signing keys, private environment values or service credentials.
- Keep ULTRON separate from Luo Chat.
- Preserve Supabase RLS, auth, provider routing, streaming, connector scopes, approvals, encrypted storage and tool permission boundaries.
- Do not introduce paid services or new dependencies unless the owner explicitly approves and the need is demonstrated.
- Do not change backend contracts or database schemas during a visual-only task.
- Do not claim a test, browser run, APK build, deployment or visual inspection happened unless it actually happened.
- Inspect current `main` before every write. Preserve other contributors' commits; use normal fast-forward commits only.

## Product topology

Treat these surfaces correctly:

1. **Canonical client: `apps/phone`.** This is the shared Vite application used as the production web client and embedded in the Capacitor Android APK. A visual or behavior change here must work in both contexts.
2. **Secondary web console: `apps/web`.** This is a separate Next.js surface. Align its tokens, typography, components and interaction language, but do not claim it has the canonical client's full feature coverage.
3. **Backend and data:** Supabase, API services, workers, provider gateways and connector services are production contracts. Do not casually redesign them to solve a visual problem.
4. **Design source of truth:** root `DESIGN.md`. Update it when tokens, page inventory, design decisions or interaction contracts change.

## The gstack sequence

Run these phases in order for substantial work. For small isolated fixes, use only the applicable phases but never skip verification.

### 1. THINK — product consultation

Use the intent behind gstack's `/office-hours` and `/plan-ceo-review`.

- Read the request, recent project context, `AGENTS.md`, `DESIGN.md`, relevant docs and current implementation.
- State the user's actual job-to-be-done, not merely the requested UI element.
- Identify the 10-star outcome, the smallest high-value delivery, and what must remain unchanged.
- Challenge weak assumptions using repository evidence. Do not invent a product requirement or silently expand scope.
- If the request is already clear, proceed without forcing an interview. Ask only one blocking question when implementation genuinely cannot proceed safely.

Deliverable: a short problem statement, constraints and measurable acceptance criteria in the task notes or plan.

### 2. PLAN — design, engineering and DX reviews

Use the intent behind `/plan-design-review`, `/plan-eng-review`, `/plan-devex-review` and `/spec`.

Before coding, inspect the complete affected surface and score these dimensions from 0–10:

- Product clarity: users understand what this page is for.
- Visual hierarchy: primary action and information are immediately obvious.
- Consistency: components follow `DESIGN.md` and shared tokens.
- Completeness: primary, secondary, nested and overlay states are accounted for.
- Responsive behavior: mobile, tablet and desktop are intentionally composed.
- Accessibility: keyboard, focus, semantics, contrast, motion and touch targets.
- Functional integrity: existing actions, IDs, data contracts and permission gates remain intact.
- Craft: alignment, spacing, typography, density, micro-interactions and empty states feel deliberate.

Target 9/10 or better on the dimensions relevant to the task. Explain any lower score and create a concrete fix. Do not use scores as decoration.

Plan:
- Files and components likely to change.
- Screens and nested states in scope.
- Reusable primitives/tokens to use or improve.
- Data and event contracts that must be preserved.
- Regression tests and viewport checks.
- Rollback-safe implementation order.

### 3. DESIGN — consultation and visual direction

Use the intent behind `/design-consultation`, `/design-shotgun` and `/design-html`.

- Follow the existing ULTRON visual language: calm dark technical surfaces, restrained warm-metal interaction accent, red reserved for the core/critical emphasis, clear typography and low visual noise.
- Do not blindly apply a reference product's layout. Borrow interaction patterns only when they improve the ULTRON task.
- Use one shared token system and a small set of reusable primitives.
- Avoid card-on-card layouts, decorative gradients, random glows, excessive borders, tiny metadata, oversized hero sections and generic AI-dashboard filler.
- Prefer content hierarchy and useful whitespace over decoration.
- Keep four functional type tiers, the 4px spacing grid, two component radii and restrained elevation described in `DESIGN.md`.
- Never add fake metrics, fabricated provider status, pretend progress, fake model availability or decorative controls that do nothing.
- For major design-direction choices, compare alternatives in source/mockups where supported. Do not generate an image as a substitute for working UI.

### 4. BUILD — implement the complete experience

Use the intent behind gstack's build and skill-authoring discipline.

- Implement the actual page, not just a mockup or a written proposal, when implementation is requested.
- Reuse existing CSS/TypeScript/HTML patterns and dependencies.
- Keep mobile-first layouts usable at 360px; add deliberate tablet and desktop compositions.
- Preserve DOM IDs, data attributes, selectors, event contracts and keyboard behavior unless every consumer and test is migrated.
- Keep styles consolidated. Do not append another override layer to hide a conflicting override layer.
- Build all relevant states: initial, loading, empty, populated, error, disconnected, expired, permission denied, disabled, pending approval, success and long-content.
- Provide meaningful skeletons for structural loading; do not use generic spinners as a substitute for layout.
- Make controls real. A visible button must have a working action or be clearly disabled with an explanation.
- Keep Android WebView, Capacitor safe areas, back navigation, keyboard resize and file chooser behavior in scope.

### 5. REVIEW — staff-engineer and simplification pass

Use the intent behind `/review`, `/investigate`, `/deslop-shared-libs` and `/test-audit`.

- Trace each changed interaction from UI event to state, API/service, persistence and error handling.
- Look for regressions that pass typecheck: stale listeners, duplicate event handlers, race conditions, hidden controls, stale state, unbounded work, incorrect error states and unsafe fallback behavior.
- Inspect security boundaries whenever credentials, Supabase, OAuth, local files, model imports or write-capable tools are touched.
- Remove redundant styles and abstractions only when safe and supported by tests.
- Add regression tests for every discovered bug.
- Never weaken assertions, skip tests, broaden permissions or silence failures to get a green build.

### 6. TEST — real user QA

Use the intent behind `/design-review`, `/qa` and `/qa-only`.

Test the changed screen and all shared components affected by it at:

- 360×800 and 390×844 mobile.
- 768×1024 tablet.
- 1280×800 and 1440×900 desktop.

Check:
- No horizontal overflow, clipped content or unreachable primary actions.
- No dialog, menu, popover or sheet extends beyond the viewport.
- Keyboard does not cover the composer or active field.
- Touch targets are at least 48px where practical.
- Focus-visible, logical tab order, Escape dismissal and focus restoration work.
- Reduced-motion preference is respected.
- Text remains legible at 200% zoom.
- Screen reader names and status announcements are meaningful.
- Loading, empty, populated, error, disconnected and permission states are accurate.
- Web and Android render the same canonical feature without WebView-only breakage.

Run the most relevant checks, then the full canonical client suite when UI-wide changes are made:
```bash
pnpm --filter @ultron/phone typecheck
pnpm --filter @ultron/phone lint
pnpm --filter @ultron/phone test
pnpm --filter @ultron/phone build
```

When `apps/web` changes, run its typecheck, lint and build scripts too. For Android changes, run the available Gradle validation/build. If a browser, emulator or Android device is unavailable, report that limitation and do not mark the relevant visual check as passed.

### 7. SHIP — safe integration

Use the intent behind gstack's `/ship`.

- Review the final diff for secrets, unrelated edits, generated files and accidental dependency changes.
- Run the relevant tests again after the final edit.
- Commit to `main` only, with a descriptive message. Never create a feature branch or force-push.
- Preserve concurrent commits and inspect the current main head before updating it.
- Do not claim a Cloudflare deployment or APK artifact exists until CI/deployment output confirms it.
- Summarize commit, files, screens, tests, build artifacts and anything not verified.

### 8. REFLECT — improve the factory

Use the intent behind gstack's `/retro` and `/document-release`.

After substantial work:
- Record newly discovered screen states or interaction contracts in `DESIGN.md`.
- Add regression cases and update the screen-coverage ledger.
- Remove obsolete guidance when a better source of truth replaces it.
- Record unresolved issues with evidence and next action, not vague TODOs.

## ULTRON screen coverage contract

The full screen and state ledger lives at `docs/ULTRON-SCREEN-COVERAGE.md`. Read it before a broad redesign and update it whenever screens are added, removed or redesigned.

At minimum, inspect these areas and their nested states:

- Chat/home, conversation history, streaming, background tasks, artifacts and composer.
- Global search, model picker, model library, import/download/load/benchmark.
- LLM API Keys universal import, provider detection, verify, save, expired, remove and masked states.
- Memory/Mind Map, node detail, search, graph loading, empty and error.
- Agents and identities, active identity, model/brain status and switching.
- Learning Review, evidence, proposal detail, approve, reject and undo.
- ULTRON Capabilities, tool/skill/run groupings, permission levels and disabled states.
- Connectors catalog, connector detail, OAuth, scopes, connected/disconnected/error states.
- Agent Workspace, team builder, task progress, artifacts, retry, cancel and approvals.
- Settings and every subsection, voice/presence, workspace tray, drawer, bottom navigation, dialogs, sheets, popovers and confirmation flows.
- Secondary Next.js pages and shared components under `apps/web/src`.

A screen is not complete because its route renders. It is complete only when its important states, interactions, responsive behavior and regression coverage have been reviewed.

## Runtime honesty

The upstream gstack repository contains its own install scripts, binaries, browser engine, hooks and host-specific registration. The Codex setup path is documented in `docs/ULTRON-GSTACK-SETUP.md` and automated by `scripts/setup-gstack-codex.sh`. If the runtime is available, verify it with `./setup --status` and `bin/gstack-doctor`, then use its relevant design, review and browser commands. Otherwise, execute this documented workflow directly with the available repository, browser and test tools. Never fabricate a gstack command result.
