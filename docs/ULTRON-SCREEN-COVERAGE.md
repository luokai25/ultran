# ULTRON screen coverage ledger

This is the working inventory for complete web and Android design coverage. It is deliberately a ledger, not a claim that every screen has already passed visual QA.

**Canonical client:** `apps/phone` (production web bundle and Capacitor Android APK).  
**Secondary web surface:** `apps/web` (Next.js console; shared design language, separate feature coverage).  
**Design authority:** root `DESIGN.md`.  
**Workflow:** `.agents/skills/ultron-gstack/SKILL.md` followed by `.agents/skills/ultron-design/SKILL.md`.

## Completion states

For each screen, record these separately:
- [ ] Source and entry point inspected
- [ ] Visual hierarchy and layout reviewed
- [ ] Primary and secondary interactions exercised
- [ ] Loading, empty, populated, error and permission states reviewed where relevant
- [ ] Mobile 360×800 and 390×844 checked
- [ ] Tablet 768×1024 checked
- [ ] Desktop 1280×800 and 1440×900 checked
- [ ] Keyboard, focus, reduced motion and accessible names checked
- [ ] Regression tests added or existing tests verified
- [ ] Web and Android parity checked for canonical-client screens

Do not mark a box from source inspection alone when it requires a browser, emulator or device.

## Canonical client: apps/phone

### Main conversation experience
- [x] App shell, top bar, ULTRON identity/core and global status
- [x] Chat/home empty state and suggested tasks
- [ ] Conversation thread and message rendering
- [ ] Streaming, stop, retry and empty-response states
- [x] Composer and model-picker visual layout
- [ ] Attachments, file previews and keyboard behavior
- [ ] Background tasks, event timeline, cancel, retry and reconnect
- [ ] Artifact tray, artifact preview, download and error states
- [ ] New conversation, conversation history and deletion confirmation

### Navigation and discovery
- [x] Mobile bottom navigation
- [x] Desktop navigation/sidebar and responsive collapse
- [x] Navigation drawer and secondary-page entry points
- [x] Model picker overlay: provider groups, no-model and disconnected states
- [ ] Global search: query, filters, results, empty, loading and error
- [ ] Workspace tray and task/artifact counts

### Models and provider credentials
- [ ] Model library: search, filters, details and availability
- [ ] Model import: GGUF and supported archive/model formats, validation and failure recovery
- [ ] Model download: source, progress, pause/resume, storage and integrity errors
- [ ] Model loading, unloading, benchmark and insufficient-memory states
- [x] LLM API Keys page and universal paste/import entry UI
- [x] Batch provider file import UI, filename detection and labelled-line parser contract
- [ ] Authenticated provider verification, save, masked display, expiry, removal and key rotation
- [ ] Provider routing and fallback status without exposing secret material

### Memory and learning
- [x] Mind Map layout, graph empty state and search entry
- [ ] Graph pan, zoom, node selection, selected-node detail and export
- [ ] Semantic memory synchronization and offline/conflict states
- [x] Learning Review layout, filters and empty-queue state
- [ ] Evidence detail, proposal approve/reject/undo and no-evidence states

### Agent configuration and capabilities
- [x] Agent Identities page layout and default identity state
- [ ] Active identity selection and identity-specific state
- [ ] Agent model, brain and capability status
- [x] Capabilities page layout, owner-session error and explicit empty states
- [ ] ULTRON Capabilities inventory, category filters, tool/skill/run detail
- [ ] Permission levels, approval requirements, enabled/disabled and failure states

### Connectors and workspace
- [x] Connector panel layout and backend-offline/disconnected state
- [ ] Connector catalog breadth, search, categories and connector detail (current catalogue shows GitHub only)
- [ ] OAuth start/callback, granted scopes, connected/expired/revoked/failed states
- [ ] Disconnect and reconnect confirmation
- [x] Agent Workspace panel layout and backend-disconnected empty state
- [ ] Team builder and 2–5 agent configuration
- [ ] Task progress, events, completion, failure, retry and cancel
- [ ] Artifact list, preview and download
- [ ] Approval request detail, exact action, scope, approve and deny

### Settings and transient surfaces
- [x] Settings sheet layout, voice/proactive switches, Cloud Sync form, backend and local-model sections
- [ ] Authenticated Cloud Sync sign-in/out, persistence and recovery
- [ ] Model import/load/unload/benchmark and storage failure states
- [ ] Microphone, notifications, Android permission and background-access recovery
- [ ] Workspace/account/session settings
- [ ] Confirmation dialogs and destructive actions
- [ ] Sheets, popovers, menus, tooltips and toast feedback
- [ ] Offline, partial connectivity and permission-denied states

## Secondary web surface: apps/web

- [ ] Landing/home page visual review
- [ ] Main navigation and responsive shell visual review
- [ ] ModelHub internal tabs, provider flows and error states
- [ ] 3D avatar scene, controls and reduced-motion states
- [ ] Voice integration (the `UltronVoice` component exists but is not mounted on this route)
- [ ] API and loading/error boundaries
- [x] Source-level shared palette, section hierarchy and production handoff
- [ ] Mobile and desktop browser visual review
- [ ] Keyboard and accessibility states

Source redesign and Node contract tests are in place. The avatar button is labelled **Preview speech** because it animates the mouth but does not produce audio. This route remains a secondary console, not feature parity with the canonical client.

## Cross-surface acceptance

- [ ] Canonical `apps/phone` web build and Android WebView show the same features and behavior.
- [ ] Safe areas, Android system back, keyboard resize and file chooser work.
- [ ] Desktop is an intentional layout, not a stretched phone screen.
- [ ] No UI-only redesign weakens Supabase RLS, auth, approvals, connector scopes or local secret storage.
- [ ] All relevant automated checks pass.
- [ ] Any unavailable visual/device check is explicitly marked unverified.

## Audit notes

- 2026-11-06: Production web is the canonical `apps/phone` bundle at `https://ultron-app-web.luo-chat-ops.workers.dev/`; the latest `ultron-web-latest` release and Worker smoke test passed. The old Pages URL is not the production source of truth. `apps/web` is a separate Next.js prototype/console.
- 2026-11-06: Source audit covered all five full-screen feature pages plus connectors, workspace, settings, model picker and global search. The LLM API Keys importer is now visible and accepts up to six provider-specific `.txt` files (1 MB each, 100 keys total), detects providers from filenames, parses labelled lines and verifies keys without rendering secret values.
- 2026-11-06: Main chat shell visually checked at 390×844 and 1440×900. The empty state, core, top bar, suggested tasks, composer/model picker, mobile bottom navigation, desktop rail and warm-metal active states were verified.
- 2026-11-06: Mobile visual review at 390×844 also covered LLM API Keys, Agent Identities, Mind Map, Learning Review, Capabilities, Connectors, Workspace and Settings. Feature-page headings/back controls now sit below the persistent top bar. Capability-load failures clear stale skeletons and show explicit disconnected empty states. Settings now uses compact accessible switches and gold primary actions.
- 2026-11-06: The browser review used a fresh unauthenticated session. Cloud pages correctly showed disconnected states. The connector catalogue currently exposes GitHub only and reports its backend offline; full Composio catalogue/OAuth verification remains open. Workspace and capability actions requiring an owner session remain unverified.
- 2026-11-06: The LLM API Keys importer reads selected `.txt` files locally, parses them in-browser and sends individual key values to the Supabase function over HTTPS; it does not upload the original text file. The owner email is no longer hard-coded in the public app HTML. Only rotated keys should be imported because the previously shared credentials were exposed in chat.
- 2026-11-06: Local model archive import currently extracts GGUF files from `.tgz`/`.tar.gz`; Safetensors and PyTorch checkpoints are not executable in this build. The model picker visual review confirms provider groups and Import/Find/Settings actions, but model installation and runtime behavior remain unverified.
- 2026-11-06: The `apps/web` secondary console now has section navigation, a production-app handoff, responsive avatar/ModelHub/architecture sections and accurate secondary-surface metadata. Node contract tests were added; typecheck, lint, test and build passed. Browser visual QA remains open.
- 2026-11-06: CI verification and web build/Worker smoke test pass. The latest Android release is still pending. Web smoke tests now retry transient Cloudflare asset-propagation failures.

## Source selector map

These selectors are grounded in the current `apps/phone/index.html` source. Recheck them when the shell changes; do not invent IDs or use this map as proof that a screen has passed QA.

| Experience | Current entry / selectors |
|---|---|
| Main chat | `#thread`, `#hero`, `#messages`, `#composer`, `#prompt` |
| Global search | `#global-search`, `#global-search-input`, `#global-search-results` |
| Model picker | `#chat-model-menu`, `#chat-model-options` |
| Model library and local runtime | `#native-model-heading`, `#native-model-select`, `#model-discovery-title`, `#model-library-results`, `#model-download-progress` |
| Agents and identities | `#agent-identities-screen`, `#identity-cards`, `#identity-details` |
| LLM API Keys | `#llm-api-keys-screen`, `#cloud-llm-files`, `#cloud-llm-import`, `#cloud-llm-keys` |
| Mind Map | `#vault-screen`, `#mindmap-search`, `#mindmap-canvas`, `#mindmap-detail` |
| Learning Review | `#learning-screen`, `#learning-proposals`, `#learning-events` |
| Capabilities | `#capabilities-screen`, `#capability-tools`, `#capability-cloud-tools`, `#capability-runs` |
| Connectors | `#connectors-panel`, `#connectors-list`, `#connector-detail-wrap`, `#connector-detail` |
| Approvals | `#composio-approvals`, `#composio-approval-list` |
| Agent Workspace | `#workspace-panel`, `#workspace-team-builder`, `#workspace-tasks`, `#workspace-artifacts` |
| Settings | `#sheet-wrap`, `#sheet-title`, `#settings-close-btn` |
| Voice and presence | `#voice-status`, `#proactive-updates-toggle`, `#voice-updates-toggle` |
| Workspace tray | `#workspace-tray`, `#workspace-tray-items` |
| Navigation | `#drawer`, `.bottom-nav` (Chat, Models, Memory, Tools, Settings), `#nav-chat`, `#nav-models`, `#nav-vault`, `#nav-connectors`, `#nav-settings` |

The secondary Next.js surface currently has one route at `apps/web/src/app/page.tsx`. It mounts `AvatarHero` and `ModelHub`; `UltronVoice` exists in the repository but is not mounted on this route. Treat the ModelHub's internal tabs and states as part of its coverage; do not report this surface as feature parity with the canonical client.
