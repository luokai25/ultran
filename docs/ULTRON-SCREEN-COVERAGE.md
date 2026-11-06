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
- [ ] App shell, top bar, ULTRON identity/core and global status
- [ ] Chat/home empty state and suggested tasks
- [ ] Conversation thread and message rendering
- [ ] Streaming, stop, retry and empty-response states
- [ ] Composer, attachments, file previews and keyboard behavior
- [ ] Background tasks, event timeline, cancel, retry and reconnect
- [ ] Artifact tray, artifact preview, download and error states
- [ ] New conversation, conversation history and deletion confirmation

### Navigation and discovery
- [ ] Mobile bottom navigation
- [ ] Desktop navigation/sidebar and responsive collapse
- [ ] Navigation drawer and nested navigation
- [ ] Global search: query, filters, results, empty, loading and error
- [ ] Model picker: provider groups, selected model, unavailable and disconnected
- [ ] Workspace tray and task/artifact counts

### Models and provider credentials
- [ ] Model library: search, filters, details and availability
- [ ] Model import: GGUF and supported archive/model formats, validation and failure recovery
- [ ] Model download: source, progress, pause/resume, storage and integrity errors
- [ ] Model loading, unloading, benchmark and insufficient-memory states
- [ ] LLM API Keys: universal paste/import, visible batch import for up to six provider-specific .txt files (1 MB each, 100 keys total), provider detection, verification, masked display, expiry and removal
- [ ] Provider detection, masked display, verification, save, expiry and removal
- [ ] Provider routing and fallback status without exposing secret material

### Memory and learning
- [ ] Memory / Mind Map graph, pan, zoom and node selection
- [ ] Mind Map search, selected-node detail, empty and error states
- [ ] Semantic memory synchronization and offline/conflict states
- [ ] Learning Review queue and evidence detail
- [ ] Proposal approve, reject, undo and no-evidence states

### Agent configuration and capabilities
- [ ] Agents and Identities list
- [ ] Active identity selection and identity-specific state
- [ ] Agent model, brain and capability status
- [ ] ULTRON Capabilities inventory and category filters
- [ ] Tool, skill and run detail
- [ ] Permission levels, approval requirements, enabled/disabled and failure states

### Connectors and workspace
- [ ] Connector catalog, search and category filters
- [ ] Connector detail, OAuth start/callback, granted scopes
- [ ] Connected, disconnected, expired, revoked and failed states
- [ ] Disconnect and reconnect confirmation
- [ ] Agent Workspace objective and run list
- [ ] Team builder and 2–5 agent configuration
- [ ] Task progress, events, completion, failure, retry and cancel
- [ ] Artifact list, preview and download
- [ ] Approval request detail, exact action, scope, approve and deny

### Settings and transient surfaces
- [ ] Settings entry and every nested section
- [ ] Model/provider settings
- [ ] Memory and sync settings
- [ ] Voice, microphone, listening, speaking and permission recovery
- [ ] Presence and proactive-notification preferences
- [ ] Workspace/account/session settings
- [ ] Confirmation dialogs and destructive actions
- [ ] Sheets, popovers, menus, tooltips and toast feedback
- [ ] Offline, partial connectivity and permission-denied states

## Secondary web surface: apps/web

- [ ] Landing/home page
- [ ] Main navigation and responsive shell
- [ ] ModelHub
- [ ] Agent/voice/3D avatar components
- [ ] API and loading/error boundaries
- [ ] Shared palette and typography parity with `DESIGN.md`
- [ ] Mobile and desktop responsive states
- [ ] Keyboard and accessibility states

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
- 2026-11-06: Main chat shell visually checked at 390×844 and 1440×900. Mobile bottom navigation, desktop rail, composer/model chooser and warm-metal active states were verified. Secondary-page interaction/state review, tablet, Android emulator/device parity and the separate `apps/web` visual review remain unchecked.
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

The secondary Next.js surface currently has one route at `apps/web/src/app/page.tsx`, with `AvatarHero`, `ModelHub` and `UltronVoice` components. Treat their internal tabs and states as part of that page's coverage; do not report this surface as feature-parity with the canonical client.
