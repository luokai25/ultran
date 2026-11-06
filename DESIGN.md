---
name: ultron
design-md-format: spec
version: 1
---

# ULTRON Design System

## Product and surface map

- Product: ULTRON, a personal AI agent that can chat, reason, use approved tools, manage models, connect services, and work across files and memory.
- Primary user: one owner operating ULTRON from an Android phone and a desktop browser.
- Canonical shared client: `apps/phone`. It is the Vite + TypeScript client used by both the production web URL and the Capacitor Android APK. Changes here must work in both surfaces.
- Secondary web application: `apps/web`, a Next.js application. It must share the same design tokens and visual language, but it is not the static bundle currently served at the canonical Pages URL.
- Backend: Supabase. Design changes must not weaken auth, RLS, secret storage, connector scopes, or approval gates.

## Design direction

- Direction: **Precision instrument, not sci-fi dashboard**. Calm, deliberate, tactile, and capable. ULTRON should feel like a serious personal operating system rather than a generic SaaS admin panel.
- Mood: confident, quiet, intelligent, focused. The orb/helm is the signature brand element; the interface around it stays useful and restrained.
- Brand expression: obsidian surfaces, cool titanium text, and a controlled warm-metal accent. The animated core may retain its crimson energy identity. Avoid flooding every button, border, icon, or heading with the accent.
- Density: comfortable on phones, information-dense but orderly on desktop. Prefer progressive disclosure over hiding essential actions.
- Personality: concise labels, plain language, clear system state. No fake activity, fake progress, decorative stats, or status claims that cannot be verified.
- Reference qualities: Linear's hierarchy and consistency, Raycast's compact command surfaces, native Android touch ergonomics, and the clarity of a well-made developer tool. Do not copy their layouts.

## Tokens

### Color

| Token | Value | Use |
|---|---|---|
| `--u-bg` | `#090A0C` | App canvas |
| `--u-surface-1` | `#101216` | Main panels |
| `--u-surface-2` | `#171B21` | Raised controls and cards |
| `--u-surface-3` | `#202630` | Hover/pressed and selected surfaces |
| `--u-border` | `rgba(220,228,238,.10)` | Default separators |
| `--u-border-strong` | `rgba(220,228,238,.18)` | Focused/important boundaries |
| `--u-text` | `#F2F4F7` | Primary text |
| `--u-text-secondary` | `#B5BDC8` | Supporting text |
| `--u-text-muted` | `#828D9B` | Metadata and hints |
| `--u-accent` | `#D5B779` | Rare primary action and selected emphasis |
| `--u-accent-strong` | `#E8CB91` | Accent text on dark surfaces |
| `--u-core` | `#E34B58` | Orb identity and core-only energy details |
| `--u-success` | `#55C99A` | Verified success |
| `--u-warning` | `#E8B45D` | Caution / pending |
| `--u-danger` | `#EF6B73` | Errors and destructive actions |
| `--u-info` | `#78A9E8` | Informational state |

Never use color alone to communicate state. Pair it with text or an icon and preserve contrast.

### Typography

Use the existing system font stack unless a bundled font already exists and has a clear performance benefit. Do not add a remote font dependency just for appearance.

Keep the UI to four functional size tiers:
- Display: 28–32px, only for page titles or empty-state hero.
- Section: 18–20px, section headings.
- Body: 14–16px, primary controls and readable content.
- Meta: 12px minimum, labels, timestamps and hints.

Use weight and spacing, not extra font sizes, to establish hierarchy. Use tabular numerals for counters and model/usage values. Monospace is reserved for technical identifiers, logs and code.

### Spacing and shape

- 4px base grid; common spacing: 4, 8, 12, 16, 20, 24, 32, 40.
- Two component radii: 12px for controls and compact cards; 16px for large panels and sheets. Pills may be fully rounded only when the shape communicates status or selection.
- One restrained elevation shadow for floating menus/sheets. Prefer borders and surface contrast for normal cards.
- Content max width: 1120px on desktop; reading width 720px; mobile gutters 16px.
- Minimum interactive target: 48×48 CSS px on touch surfaces; 44px minimum only for tightly grouped secondary icon actions when necessary.

### Motion

- Functional motion only: 120–180ms for hover/press, 180–260ms for panels and navigation.
- Use opacity/transform and avoid animating layout dimensions.
- Respect `prefers-reduced-motion`.
- No infinite animation except the assistant core when it communicates a real state. No pulsing dots as generic decoration.

## Layout rules

### Mobile / Android

- One-column content with bottom navigation for the five primary destinations.
- Keep the composer, send/stop controls, and model selector reachable without covering content or the keyboard.
- Use full-screen pages for deep tasks, bottom sheets for short contextual choices, and dialogs only for consequential confirmation.
- Respect safe areas, keyboard resize, system back, and scroll restoration.
- Do not squeeze desktop tables into unreadable columns; convert them to stacked rows/cards with labels.

### Desktop web

- Use a persistent left navigation rail/sidebar for primary destinations, with a centered content column and optional contextual right rail only when it adds real value.
- Keep global search, account/agent identity, connection state, and new conversation in consistent locations.
- Avoid duplicating mobile bottom-nav patterns on desktop.
- Use responsive breakpoints based on content fit, not device names.

## Shared components

Build and reuse a small set of primitives before creating page-specific styling:
- App shell, navigation item, page header, section header.
- Button: primary, secondary, quiet, destructive.
- Icon button with accessible name and tooltip.
- Text field, search field, select, textarea, toggle, segmented control.
- Surface/card, list row, data table, status badge, empty state, error state.
- Modal, bottom sheet, popover, toast, skeleton.
- Chat message, tool activity row, streaming cursor, composer.
- Model/provider row, connector row, permission/approval row, artifact row.
- Mind-map node and edge styles.

Each component must define default, hover, focus-visible, pressed, disabled, loading, success, and error behavior where applicable.

## Page inventory and design requirements

All current screens are in scope. Do not treat the home/chat screen as the whole product.

| Area | Current entry / screen | Required experience |
|---|---|---|
| Chat / Home | `#thread`, `#hero`, composer | Focused conversation workspace, legible messages, visible model/Auto state, reliable streaming, helpful empty state |
| Global search | `#global-search` | Search dialog with query, filters, result groups, loading/empty/error states |
| Model picker | `#chat-model-menu` | Anchored popover, provider grouping, active model, clear unavailable/connected states |
| Model library | `#nav-models`, model discovery controls | Search/filter/import/download/load/benchmark flows with progress and storage warnings |
| Memory / Mind Map | `#vault-screen`, `#mindmap-search` | Readable graph, search, selected-node detail, empty/loading/error states, mobile pan/zoom controls |
| Agents & Identities | `#agent-identities-screen` | Clear identity list, active identity, capabilities, model and brain status |
| LLM API Keys | `#llm-api-keys-screen` | One universal paste flow, detected provider, masked key metadata, verify/save/remove states, never expose secrets |
| Learning Review | `#learning-screen` | Evidence-based learning queue, before/after context, approve/reject/undo states |
| ULTRON Capabilities | `#capabilities-screen` | Capability inventory, permission level, enabled state, tool/skill/run groupings |
| Connectors | `#connectors-panel`, `#connector-detail-wrap`, `#connector-detail` | Searchable connector catalog, connection state, OAuth actions, scopes, disconnect and error states |
| Agent Workspace | `#workspace-panel`, `#workspace-team-builder` | Objective, agents, tasks, artifacts, progress and approval controls |
| Settings | `#sheet-wrap` and settings sections | Grouped settings, clear persistence feedback, safe destructive actions |
| Approval surfaces | `#composio-approvals`, `#approval-panel` | Exact action, requested scope, consequences, approve/deny controls |
| Drawer / Navigation | `#drawer`, bottom navigation | Consistent labels, active state, keyboard and touch behavior |
| Voice / Presence | voice controls and presence settings | Honest mic/listening/speaking state, permission recovery and accessible controls |
| Workspace tray | `#workspace-tray` | Compact artifact/task access with count and empty state |

Also inspect every nested tab, popover, modal, sheet, subview and conditional state found in the source. Update this inventory when the product gains screens.

## Interaction and accessibility contract

- Semantic HTML first. Every icon-only control has an accessible name.
- Visible focus, logical tab order, Escape to close transient UI, and focus restoration to the trigger.
- Inputs have persistent labels; placeholders are examples, not labels.
- Status changes use an appropriate live region without announcing every streaming token.
- Touch targets are 48px, controls have clear disabled states, and text remains readable at 200% zoom.
- Support reduced motion and Android keyboard/safe-area behavior.
- Preserve all existing element IDs and event contracts unless a migration updates every consumer and test.

## Quality gates

A page is not complete until it passes:
1. Visual hierarchy, spacing, typography, color, alignment and responsive review.
2. 360×800 and 390×844 mobile; 768×1024 tablet; 1280×800 and 1440×900 desktop.
3. Loading, empty, populated, error, disconnected, disabled, permission-denied and long-content states where relevant.
4. Keyboard-only navigation, visible focus, reduced motion and screen-reader labels.
5. No horizontal overflow, clipped dialogs, hidden primary actions, or keyboard-obscured composer.
6. Existing behavior and integration tests remain green.
7. The same `apps/phone` build works as web and inside the Android WebView.

## Non-goals and guardrails

- Do not change provider routing, chat transport, model formats, Supabase schema, authentication, RLS, Vault, connector permissions or tool execution as part of a visual-only change.
- Do not remove features to make a page look simpler.
- Do not invent fake charts, metrics, model availability, connection states or progress.
- Do not add a UI framework, component library, icon library, font CDN or animation dependency without proving it is needed.
- Keep ULTRON standalone; do not couple it to Luo Chat.
- Preserve the existing app shell and Capacitor architecture.

## Decisions log

| Decision | Rationale |
|---|---|
| Shared tokens across phone and web | The Android APK and canonical web client share `apps/phone`; the secondary Next.js app should not drift. |
| Obsidian + titanium + restrained warm-metal accent | Makes the interface calm and technical while preserving a recognizable ULTRON core. |
| Four typography tiers and two radii | Reduces visual noise and prevents every feature from inventing its own design language. |
| Full screen inventory required | Secondary pages must receive the same design quality as chat. |

## Initial implementation audit

Source-level inspection on 2026-11-06 found these concrete design issues. These are audit findings, not claims of browser-tested behavior:

1. **Competing theme layers.** The phone shell loads base, workspace, experience, finishing, design-system and quiet-UI styles in sequence. Several layers define overlapping colors and component styles. Canonical `--u-*` tokens are now defined in the final phone layer and mirrored in the Next.js stylesheet; legacy aliases remain temporarily for compatibility.
2. **Brand expression drift.** The phone shell had drifted to a fully monochrome accent while the separate Next.js app used a different gold palette and the older phone base layer still contained a crimson palette. The new shared tokens define warm-metal interaction accents and reserve crimson for the ULTRON core. Remaining hard-coded legacy values must be migrated page by page.
3. **Desktop layout needed an intentional composition.** The initial source audit found only narrow-width overrides. A persistent 80px desktop navigation rail, wider content canvas, full-height secondary screens and desktop sheet sizing have since been added. These are source-implemented but remain unchecked in the screen-coverage ledger until browser/device QA runs at the required viewports.
4. **Secondary screens are functional but visually uneven.** Agents & Identities, LLM API Keys, Mind Map, Learning Review and Capabilities each have distinct content structures; connectors, workspace, approvals, search and model selection are separate overlay surfaces. They need page-specific hierarchy built from shared primitives, not one generic card treatment.
5. **Two web surfaces exist.** The canonical deployed web client is the `apps/phone` static bundle, also used by the Android APK. `apps/web` is a separate Next.js pre-alpha surface with a small landing page and ModelHub, not the production app shell. Both now share the token vocabulary; do not assume they have identical feature coverage.

## Redesign execution order

1. App shell, desktop navigation, mobile bottom navigation, drawer, page headers and global overlays.
2. Chat, streaming states, composer, model picker and global search.
3. Model library, API keys, agent identities and voice/presence.
4. Mind Map and Learning Review.
5. Capabilities, connectors, OAuth detail, approvals and Agent Workspace.
6. Settings, nested sheets, dialogs, empty/loading/error/permission states.
7. Align the Next.js surface to the same system and remove its pre-alpha visual mismatch without falsely presenting it as the canonical production client.

A phase is complete only after the page inventory, interaction states, responsive checks and relevant regression tests are updated.

## Product workflow and screen coverage

The complete product-to-production workflow is defined in `.agents/skills/ultron-gstack/SKILL.md`. Use it for product framing, design planning, implementation review, QA, safe integration and retrospective.

The detailed UI implementation workflow is defined in `.agents/skills/ultron-design/SKILL.md`.

The current screen-by-screen completion ledger is `docs/ULTRON-SCREEN-COVERAGE.md`. It distinguishes source inspection from actual interaction, responsive, accessibility, browser and Android-device verification. An unchecked item must not be reported as complete. Update the ledger whenever screens or states are added, removed or redesigned.
