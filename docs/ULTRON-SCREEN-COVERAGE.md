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
- [ ] App shell, top bar, text-first ULTRON identity and global status
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

- 2026-11-06, initial source inventory: Repository screens and source entry points were catalogued. This was not visual/device verification.
- 2026-11-06, gstack redesign pass: Upstream gstack `1.96.0.0` was installed in the active isolated coding environment. `setup --status` confirmed Codex global skill registration. A fresh doctor recheck in this active coding box reported Bun 1.4.4, 12 checks OK, 1 warning, 1 not configured and 0 failures; Codex authentication and cross-machine artifact sync remain host-dependent. The repository includes `scripts/setup-gstack-codex.sh` for a user's local Codex environment.
- 2026-11-06, design spec: `DESIGN.md` was converted to gstack spec format with machine-readable `colors`, `typography`, `rounded`, `spacing` and `components` token groups. `gstack-design-md check DESIGN.md` and token extraction passed.
- 2026-11-06, canonical-client browser QA: The deployed Cloudflare app was checked at 360×800, 390×844, 768×1024, 1280×800 and 1440×900 with no horizontal overflow, failed network responses or browser JavaScript errors. Model picker, Vault, Connectors, Settings, Identities, Mind Map, Learning, Capabilities, LLM API Keys and Workspace were opened through their visible controls; Escape dismissal was checked for the model picker and secondary surfaces. Regression tests cover the scroll, fallback and transient-surface defects.
- 2026-11-06, desktop overlay correction: Secondary feature screens and Settings were 80px too wide because a legacy `width:100%` overrode the desktop left/right insets. `.feature-screen` and `.sheet-wrap` now use inset-driven `width:auto`; all checked desktop overlays align exactly from x=80 to x=1280 at 1280px width. Regression assertions cover this geometry contract.
- 2026-11-06, Mind Map empty state: Browser QA found the empty SVG root node overlapping the empty-state message and forcing horizontal pan on a 390px phone. The empty graph now hides its SVG, uses a centered ULTRON core treatment and removes the empty-state horizontal scrollbar; the 390×844 preview was rechecked with no document overflow.
- 2026-11-06, secondary-web browser QA: The Next.js console was checked at 1440px desktop and 390px mobile with no document horizontal overflow. Navigation, ModelHub tabs, owner sign-in panel and the native-runtime information state were exercised. The 3D renderer now falls back to a CSS core when WebGL2 is unavailable; voice playback uses browser speech when supported and no longer calls an unconfigured localhost API.
- 2026-11-06, automated checks: `apps/phone` typecheck, lint and 249 tests passed; phone production build passed. `apps/web` lint, typecheck, five console contract tests and production build passed. GitHub CI runs `42265290791` and `42265977340` completed successfully. The deployed canonical app served the current Vite bundle hash `index-XGazd8vh.js`.
- 2026-11-06, touch-target audit: Learning Review's short `All` filter was 38px wide on mobile. Its filter controls now measure at least 48×48px; the browser check confirmed the three filter targets are 48×48px, 108×48px and 69×48px at 390px viewport width.
- Still unverified: Android physical-device visual parity, live authenticated owner key operations, actual local model import/download/load, OAuth provider callbacks, backend voice rendering, and every secondary screen's full loading/error/permission matrix. Do not mark those complete based on this pass.

- 2026-11-06, Android release: Signed ULTRON 3.0.4 build 896 was published from the canonical phone client. CI verified the merged manifest and APK signature, then installed and launched the APK in an Android 12 emulator successfully. This is install/launch smoke coverage, not physical-device visual parity.

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
| Navigation | `#drawer`, `.bottom-nav`, `#nav-chat`, `#nav-models`, `#nav-vault`, `#nav-connectors`, `#nav-settings` |

The secondary Next.js surface currently has one route at `apps/web/src/app/page.tsx`, composed by `UltronConsole` with `AvatarHero`, `ModelHub` and `UltronVoice`. Treat its navigation anchors, internal tabs, API-key flow, browser-speech fallback and 3D/WebGL fallback as part of that page's coverage; do not report this surface as feature-parity with the canonical client.

- 2026-11-06, cinematic redesign pass: Added a dedicated gstack-reviewed motion layer to the shared `apps/phone` client used by the production web app and Capacitor APK. It adds the animated grid/nebula atmosphere, orbital core movement, glass-metal surfaces, responsive 92px desktop rail, wide desktop chat composition, and animated secondary-page entry. The WebGL-unavailable CSS core fallback remains round. All motion honors reduced-motion preferences.
- 2026-11-06, Supabase connection resilience: `getCloudSession()` now proactively refreshes expiring sessions with a single-flight guard. The cloud-brain function gateway retries one authenticated 401 after refresh; direct SSE chat does the same. LLM API key inventory and worker health now load independently so a transient health endpoint failure cannot hide saved Vault keys. Auth state changes update connection status, and the key screen has an explicit refresh/reconnect action.
- 2026-11-06, live metadata check: Supabase reports 15/15 connected OpenRouter keys, 15/15 connected Groq keys and 15/15 connected Google AI Studio keys. `ultron-brain` Edge Function is ACTIVE at version 16. No secret values were read or displayed.
- 2026-11-06, gstack environment: gstack `1.96.0.0` is registered as a global Codex skill. With Bun 1.4.4 selected from the user-local install, `gstack-doctor` reports 12 checks OK, one Codex-auth warning, artifact sync not configured, and zero failures. `gstack-design-md check DESIGN.md` passes. The project has a reusable `scripts/setup-gstack-codex.sh` installer and customized `DESIGN.md` motion contract.
- 2026-11-06, local browser QA: 390×844 mobile and 1440×900 desktop previews showed no document horizontal overflow, browser exceptions or failed network responses across Chat, Models, Mind Map, Connectors, Settings, Identities, Learning Review, Capabilities and LLM API Keys. Desktop navigation is a persistent side rail; mobile retains the bottom bar. Authenticated live sign-in was not simulated in this browser run.


## AI Digital Product Studio (added 2026-11-09)

Canonical feature screen: `#product-studio-screen`.

- Entry: three-line drawer item "AI Digital Products Generating" in canonical `apps/phone`.
- Start states: disconnected cloud account, empty project list, request prompt, autonomous opportunity discovery, research-depth selector, queueing and queue errors.
- Workspace states: queued, active generation, live event timeline, source counters (discovered/opened/analyzed/rejected/failed), source detail links, sandboxed HTML preview, private Markdown download, partial completion, provider unavailable, cancellation and refresh/reconnect.
- Data: owner-scoped Supabase Product Studio tables and durable `product.generate` jobs.
- Verification still required: 360x800, 390x844, 768x1024, 1280x800, 1440x900; keyboard/focus; Android WebView; live signed download; free-model quota exhaustion; worker retry/recovery; large/long product previews.


- 2026-11-09, full visual reset initiated: The canonical `apps/phone` shell now loads one replacement stylesheet, `src/chatgpt-ui.css`, instead of the previous nine-layer stylesheet stack. The new direction removes the orb/hero visuals and cinematic effects, uses a ChatGPT-like charcoal conversation workspace, and keeps the existing feature markup and DOM contracts in place. The production web and APK share this client. This is an implementation start, not a completion claim: visual QA across the full screen inventory, typecheck, lint, tests, build, Android WebView parity and live backend interactions remain to be run.

- 2026-11-09, visual reset follow-through: Removed the orb DOM, assistant SVG mark, favicon mark generation and unused Three.js/WebGL renderer rather than merely hiding the canvas. The home greeting is now static and text-first. Reused the single Supabase/Android secure-storage plugin registration from `cloud-sync.ts` to eliminate the duplicate native bridge registration warning. Local/offline mode is now represented as `data-health="local"`, not a global broken state; individual tool failures no longer mark the whole app broken. The replacement UI is live, but this follow-through still requires a fresh CI and browser regression pass.

- 2026-11-09, secondary-page design pass: The canonical single stylesheet now applies the same charcoal surfaces, typography, restrained green actions, responsive grids, form controls and list/card treatment across Agents & Identities, LLM API Keys, Product Studio, Vault/Mind Map, Learning Review, Capabilities, Connectors and Workspace. This is a shared design-system pass; the screen-by-screen populated/loading/error/permission states and Android physical-device parity still require visual QA.
- 2026-11-09, Google OAuth click path: The active `ultron-connectors` Edge Function is deployed. The owner-scoped `composio_gateway` settings query returned no stored row, so the app cannot generate a Google redirect from the Vault-backed owner setting yet. The client now explains the one-time Composio Project API key prerequisite and focuses the key field instead of leaving the user with a failed redirect. Once the key is verified and saved to Vault, the Connect account gesture reserves a browser tab before the async request and navigates it to Google's managed authorization URL. Google AI Studio model API keys are not OAuth gateway credentials.
- 2026-11-09, local health semantics: A cloud-backend outage now leaves the local-first app in `data-health="local"`; the separate connection indicator continues to show the cloud as unreachable. A missing cloud endpoint is not a broken local application.
