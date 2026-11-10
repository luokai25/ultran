---
# gstack: design-md-format=spec
name: ultron
design-md-format: spec
version: 1
colors:
  background: "#212121"
  surface-1: "#2F2F2F"
  surface-2: "#383838"
  surface-3: "#414141"
  border: "rgba(255,255,255,.09)"
  border-strong: "rgba(255,255,255,.16)"
  text: "#F5F5F5"
  text-secondary: "#C5C5C5"
  text-muted: "#999999"
  accent: "#10A37F"
  accent-strong: "#0E9272"
  success: "#55C99A"
  warning: "#E8B45D"
  danger: "#EF6B73"
  info: "#78A9E8"
typography:
  display: "28-36px"
  section: "18-20px"
  body: "14-16px"
  meta: "12px"
rounded:
  control: "9px"
  panel: "12px"
  pill: "999px"
spacing:
  base: "4px"
  x1: "4px"
  x2: "8px"
  x3: "12px"
  x4: "16px"
  x5: "20px"
  x6: "24px"
  x8: "32px"
  x10: "40px"
components:
  touch-target: "48px"
  content-max: "1120px"
  reading-width: "720px"
  mobile-gutter: "16px"
  floating-shadow: "0 16px 44px rgba(0,0,0,.18)"
motion:
  enter: "180ms ease"
  surface: "150ms ease"
  ambient: "none"
  reduced-motion: "required"
---

# ULTRON Design System

## Overview

- Product: ULTRON, a personal AI agent that can chat, reason, use approved tools, manage models, connect services, and work across files and memory.
- Primary user: one owner operating ULTRON from an Android phone and a desktop browser.
- Canonical shared client: `apps/phone`. It is the Vite + TypeScript client used by both the production web URL and the Capacitor Android APK. Changes here must work in both surfaces.
- Production web endpoint: `https://ultron-pied-gamma.vercel.app/` serves the canonical `apps/phone` Vite client from Vercel Git integration; the Capacitor Android APK uses the same client. Do not route the public site through Cloudflare.
- Backend: Supabase cloud functions and Vault, with an optional Python control plane. The public client has no per-visitor account flow; keep provider secrets server-side and preserve connector/tool permissions.

**Design direction:** a clean, familiar conversation workspace inspired by ChatGPT. The entire interface is rebuilt around readable conversations, a bottom composer, a persistent desktop sidebar, restrained charcoal surfaces and subtle green interaction states. ULTRON branding is text-first. No orb, avatar, animated core, HUD, sci-fi decoration, glass panels, ambient effects or stacked card dashboard. Keep every existing capability, but organize secondary functions into clear pages reachable from navigation.

- Mood: familiar, calm, focused and useful. The product identity comes from ULTRON's name and behavior, not a mascot or animated centerpiece.
- Brand expression: charcoal surfaces, neutral text, restrained green interaction states and subtle borders. Red is reserved for destructive or error states. Avoid decorative gradients, glow and visual noise.
- Density: comfortable on phones, information-dense but orderly on desktop. Prefer progressive disclosure over hiding essential actions.
- Personality: concise labels, plain language, clear system state. No fake activity, fake progress, decorative stats, or status claims that cannot be verified.
- Reference qualities: Linear's hierarchy and consistency, Raycast's compact command surfaces, native Android touch ergonomics, and the clarity of a well-made developer tool. Do not copy their layouts.

## Colors

| Token | Value | Use |
|---|---|---|
| `--bg` | `#212121` | App canvas |
| `--surface` | `#2F2F2F` | Composer and raised controls |
| `--surface-raised` | `#383838` | Hovered and active controls |
| `--surface-soft` | `#262626` | Quiet secondary surfaces |
| `--border` | `rgba(255,255,255,.09)` | Default separators |
| `--border-strong` | `rgba(255,255,255,.16)` | Focused boundaries |
| `--text` | `#F5F5F5` | Primary text |
| `--text-secondary` | `#C5C5C5` | Supporting text |
| `--muted` | `#999999` | Metadata and hints |
| `--accent` | `#10A37F` | Primary actions and selected states |
| `--accent-hover` | `#0E9272` | Hovered primary actions |
| `--success` | `#55B98A` | Verified success |
| `--warning` | `#D5A85D` | Caution / pending |
| `--danger` | `#E06B6B` | Errors and destructive actions |
| `--info` | `#8AB8E8` | Informational state |

Never use color alone to communicate state. Pair it with text or an icon and preserve contrast. Green is reserved for active/primary interactions; red is reserved for danger and errors.
## Typography

Use the existing system font stack unless a bundled font already exists and has a clear performance benefit. Do not add a remote font dependency just for appearance.

Keep the UI to four functional size tiers:
- Display: 24–32px, only for page titles or the empty-state greeting.
- Section: 18–20px, section headings.
- Body: 14–16px, primary controls and readable content.
- Meta: 12px minimum for labels, timestamps and hints. Technical identifiers, logs and code may use a compact monospace face.

Use weight and spacing, not extra font sizes, to establish hierarchy. Use tabular numerals for counters and model/usage values. Monospace is reserved for technical identifiers, logs and code.

## Layout

- 4px base grid; common spacing: 4, 8, 12, 16, 20, 24, 32, 40.
- Content max width: 1120px on desktop; reading width 720px; mobile gutters 16px.
- Minimum interactive target: 48×48 CSS px on touch surfaces; 44px minimum only for tightly grouped secondary icon actions when necessary.
- Use a 12-column desktop grid where a page needs multiple information groups. Use two-column hero/workspace compositions when the viewport has room; do not stretch short reading content across the screen.
- Secondary pages need their own hierarchy and useful density. Do not style every page as one generic stack of cards.

### Mobile / Android

- One-column content with bottom navigation for the five primary destinations.
- Keep the composer, send/stop controls, and model selector reachable without covering content or the keyboard.
- Use full-screen pages for deep tasks, bottom sheets for short contextual choices, and dialogs only for consequential confirmation.
- Respect safe areas, keyboard resize, system back, and scroll restoration.
- Do not squeeze desktop tables into unreadable columns; convert them to stacked rows/cards with labels.

### Desktop web

- Use a persistent left sidebar for primary destinations and conversation history, with a centered chat column.
- Keep global search, ULTRON identity, connection state, and new conversation in consistent locations.
- Avoid duplicating mobile bottom-nav patterns on desktop.
- Use responsive breakpoints based on content fit, not device names.

## Motion language

- No orb, avatar hero, animated core, particle field, HUD, ambient grid or decorative brand animation. ULTRON is expressed through its name, typography and product behavior.
- No ambient motion or decorative atmosphere. Use short, quiet transitions only for menus, focus and state changes.
- Do not animate page entry or reveal content on scroll. Every page and action must be immediately available.
- Interactive surfaces use restrained color and border feedback. Avoid lift, springy overshoot, continuous motion and full-page parallax.
- Motion durations: 150–180ms for menus and control feedback. There are no ambient loops or scroll-linked animations. Honor `prefers-reduced-motion`.
- Keep animation on `transform` and `opacity`; do not animate layout geometry. All animated layers are pointer-transparent and decorative.

## Elevation & Depth

- Use one restrained elevation shadow for floating menus and sheets: `0 16px 44px rgba(0,0,0,.18)`.
- Prefer borders, surface contrast, and subtle inner highlights for normal cards instead of stacking shadows.
- Do not use glow, glassmorphism, gradients or layered card stacks. Use flat surfaces and restrained borders.
- Avoid backdrop blur. Keep normal and floating surfaces opaque enough for contrast.

## Shapes

- Two component radii: 9px for controls; 12px for panels and sheets.
- Pills may be fully rounded only when the shape communicates status or selection.
- Avoid excessive nested borders, ornamental outlines, and unrelated corner radii.
- Keep the interface typographic and functional. Do not introduce an assistant mascot, orb or ornamental identity mark.

## Components

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

Each component must define default, hover, focus-visible, pressed, disabled, loading, success, and error behavior where applicable. Components should preserve stable IDs and event contracts unless a migration updates every consumer and test.

## Do's and Don'ts

- Do not change provider routing, chat transport, model formats, Supabase schema, Vault, connector permissions or tool execution as part of a visual-only change.
- Do not remove features to make a page look simpler. Make dense functionality understandable through hierarchy, grouping and progressive disclosure.
- Do not invent fake charts, metrics, model availability, connection states or progress.
- Do not add a UI framework, component library, icon library, font CDN or animation dependency without proving it is needed.
- Keep ULTRON standalone; do not couple it to Luo Chat.
- Preserve the existing app shell and Capacitor architecture.
- Keep destructive actions explicit and approvals specific to the exact action and scope.

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
| Agent Workspace | `#workspace-panel`, `#workspace-team-builder` | Objective, agents, tasks, artifacts, progress and approval controls |\n| AI Digital Product Studio | `#product-studio-screen` | Problem/opportunity input, research depth, durable project list, real source coverage, event timeline, private artifact download and sandboxed live preview |
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

## Decisions log

| Decision | Rationale |
|---|---|
| Shared tokens across phone and web | The Android APK and canonical web client share `apps/phone`; the secondary Next.js app should not drift. |
| ChatGPT-like charcoal surfaces + restrained green interaction accent | Keeps the interface familiar, calm and focused on conversation rather than decoration. |
| Four typography tiers and two radii | Reduces visual noise and prevents every feature from inventing its own design language. |
| Full screen inventory required | Secondary pages must receive the same design quality as chat. |

## Current implementation audit

Source and live-browser review on 2026-11-09:

1. **Design reset shipped to the canonical client.** `apps/phone/index.html` loads only `src/chatgpt-ui.css`; the previous nine-layer style stack is no longer linked. The web build is the same client used by the Android APK.
2. **Orb and cinematic identity removed from the app shell.** The hero canvas, orbital DOM, SVG brand mark, favicon mark generation and Three.js/WebGL renderer were removed. ULTRON is text-first.
3. **Conversation-first layout shipped.** The home state says “How can I help?”, the model selector sits above the bottom composer, desktop uses a persistent 260px sidebar, and mobile retains compact bottom navigation.
4. **Secondary screens use the same shared design system.** LLM API Keys, model management, Agents & Identities, Mind Map, Learning Review, Capabilities, Connectors, Workspace, Product Studio and Settings now share the charcoal surfaces, neutral typography, green interaction accent, page headers and list/card primitives. Full state-by-state visual and interaction QA remains outstanding.
5. **Backend contracts are retained.** Supabase owner sessions, RLS-backed cloud data, streaming, provider keys, native secure storage, connector permissions and approval gates must remain intact through the visual rebuild.
6. **Regression cleanup is in progress.** Legacy tests that asserted the old orb and stacked stylesheet design are being replaced with tests for the new single-stylesheet shell. The Vite build has passed; the full CI test suite is being reconciled with the new design contract.
## Redesign execution order

1. App shell, desktop navigation, mobile bottom navigation, drawer, page headers and global overlays.
2. Chat, streaming states, composer, model picker and global search.
3. Model library, API keys, agent identities and voice/presence.
4. Mind Map and Learning Review.
5. Capabilities, connectors, OAuth detail, approvals and Agent Workspace.
6. Settings, nested sheets, dialogs, empty/loading/error/permission states.
7. Keep the legacy Next.js entry point routed to the canonical web/Android client; do not maintain a second divergent console.

A phase is complete only after the page inventory, interaction states, responsive checks and relevant regression tests are updated.

## Product workflow and screen coverage

The complete product-to-production workflow is defined in `.agents/skills/ultron-gstack/SKILL.md`. Use it for product framing, design planning, implementation review, QA, safe integration and retrospective.

The detailed UI implementation workflow is defined in `.agents/skills/ultron-design/SKILL.md`.

The current screen-by-screen completion ledger is `docs/ULTRON-SCREEN-COVERAGE.md`. It distinguishes source inspection from actual interaction, responsive, accessibility, browser and Android-device verification. An unchecked item must not be reported as complete. Update the ledger whenever screens or states are added, removed or redesigned.
