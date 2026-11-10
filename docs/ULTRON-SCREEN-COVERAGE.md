# ULTRON screen coverage ledger

This is the authoritative screen inventory for the one shared web and Android client. It records what must be checked; it does not claim that every item has passed visual or device QA.

**Canonical client:** `apps/phone`  
**Web host:** Vercel  
**Android:** Capacitor APK  
**Design authority:** `DESIGN.md`  
**Workflow:** `.agents/skills/ultron-gstack/SKILL.md` and `.agents/skills/ultron-design/SKILL.md`

## Completion checklist

For each screen, record these separately:

- [ ] Source and entry point inspected
- [ ] Visual hierarchy and layout reviewed
- [ ] Primary and secondary interactions exercised
- [ ] Loading, empty, populated, error and offline states reviewed
- [ ] Mobile 360×800 and 390×844 checked
- [ ] Tablet 768×1024 checked
- [ ] Desktop 1280×800 and 1440×900 checked
- [ ] Keyboard, focus, reduced motion and accessible names checked
- [ ] Regression tests added or existing tests verified
- [ ] Web and Android behavior parity checked

Do not mark a browser, emulator or device check complete from source inspection alone.

## Main conversation experience

- [ ] App shell, top bar, ULTRON identity and connection status
- [ ] Chat/home empty state and suggested tasks
- [ ] Conversation thread and message rendering
- [ ] Streaming, stop, retry, timeout and empty-response states
- [ ] Composer, attachments, file previews and keyboard behavior
- [ ] Background tasks, progress events, cancel, retry and reconnect
- [ ] Artifact tray, preview, download and failure recovery
- [ ] New conversation, history, restore and deletion

## Navigation and discovery

- [ ] Mobile bottom navigation
- [ ] Desktop sidebar and responsive collapse
- [ ] Three-line navigation drawer and nested navigation
- [ ] Global search: query, filters, results, empty, loading and error
- [ ] Model picker: Automatic, imported local models and unavailable states
- [ ] Workspace tray and task/artifact status

## Models and provider credentials

- [ ] Model library search, filters, details and availability
- [ ] GGUF and supported archive imports, validation and recovery
- [ ] Model download progress, pause/resume, storage and integrity errors
- [ ] Model load, unload, benchmark and insufficient-memory states
- [ ] LLM API Keys universal paste/import and provider detection
- [ ] Batch key import, verification, masked display, expiry and removal
- [ ] Provider routing and fallback status without exposing secret material

## Memory and learning

- [ ] Memory / Mind Map graph, pan, zoom and node selection
- [ ] Mind Map search, selected-node detail, empty and error states
- [ ] Semantic memory sync, offline and conflict states
- [ ] Learning Review queue and evidence detail
- [ ] Proposal approve, reject, undo and no-evidence states

## Agent configuration and capabilities

- [ ] Agents and Identities list
- [ ] Active ULTRON identity and capability status
- [ ] Model and brain status
- [ ] Capability inventory and category filters
- [ ] Tool, skill and run details
- [ ] Permission levels, approval requirements and failure states

## Connectors and workspace

- [ ] Connector catalog, search and category filters
- [ ] Connector details and OAuth start/callback
- [ ] Connected, disconnected, expired, revoked and failed states
- [ ] Disconnect and reconnect
- [ ] Agent Workspace objective and run list
- [ ] Team builder and agent configuration
- [ ] Task progress, events, completion, failure, retry and cancel
- [ ] Artifact list, preview and download
- [ ] Approval request detail, exact action, scope, approve and deny

## Settings and transient surfaces

- [ ] Settings entry and nested sections
- [ ] Model and provider settings
- [ ] Memory and sync settings
- [ ] Voice, microphone, listening, speaking and permission recovery
- [ ] Presence and proactive notification preferences
- [ ] Workspace and runtime settings
- [ ] Confirmation dialogs and destructive actions
- [ ] Sheets, popovers, menus, tooltips and toast feedback
- [ ] Offline, partial connectivity and permission-denied states

## Shared client screen inventory

The six full-screen destinations in `apps/phone/index.html` are:

| Screen | Element ID |
| --- | --- |
| Agent identities | `agent-identities-screen` |
| LLM API keys | `llm-api-keys-screen` |
| AI Product Studio | `product-studio-screen` |
| Memory / Vault | `vault-screen` |
| Learning Review | `learning-screen` |
| ULTRON Capabilities | `capabilities-screen` |

Other major screen and surface IDs include:

- Chat: `thread`, `hero`, `prompt`
- Search and models: `global-search`, `chat-model-menu`, `nav-models`
- Connectors: `connectors-panel`, `connector-detail-wrap`, `connector-detail`
- Workspace: `workspace-panel`, `workspace-team-builder`, `workspace-tray`
- Approvals: `composio-approvals`, `composio-approval-list`
- Settings: `sheet-wrap`, `sheet-title`, `settings-close-btn`

## Cross-surface acceptance

- [ ] Vercel web build and Android WebView show the same features and behavior.
- [ ] Android safe areas, system back, keyboard resize and file chooser work.
- [ ] Desktop is an intentional layout, not a stretched phone screen.
- [ ] Provider credentials remain in Vault and never appear in browser storage or the APK.
- [ ] Connector permissions and approval requirements remain consistent.
- [ ] All relevant automated checks pass.
- [ ] Unavailable visual/device checks are explicitly marked unverified.
