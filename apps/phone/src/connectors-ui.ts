/**
 * Connectors screen.
 *
 * The catalog ships inside the app (`connectors.catalog.json`, generated from the
 * backend catalog by `ultron-backend/tools/export_catalog.py`), so the full list
 * is browsable with no network. Enabling and connecting go to the linked Ultron
 * backend; with no endpoint set the screen is read-only and says so.
 *
 * Secrets: a key typed here is sent once to the backend vault and cleared from
 * the field immediately. It is never written to local storage.
 */

import catalogJson from "./connectors.catalog.json";
import { listUltronConnectors, listUltronConnectorTools, setUltronConnectorToolPermission, startUltronConnectorConnection, refreshUltronConnectorStatus, disconnectUltronConnector, saveUltronComposioApiKey } from "./connectors-cloud";
import type { UltronConnectorTool } from "./connectors-cloud";

export type CatalogEntry = {
  id: string;
  name: string;
  category: string;
  auth: "api_key" | "oauth2" | "none" | "webhook";
  tier: "free" | "paid";
  actions: string[];
  description: string;
};

type PreparedExternal = {
  open: (url: string) => Promise<void>;
  cancel: () => void;
};

type Deps = {
  /** True when a brain endpoint is linked. */
  linked: () => Promise<boolean>;
  backendLinked: () => boolean;
  api: (path: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  closeDrawer: () => void;
  openExternal: (url: string) => Promise<void>;
  /** Reserve a browser tab synchronously in the click gesture, before network awaits. */
  prepareExternal?: () => PreparedExternal;
};

const CATALOG = catalogJson as CatalogEntry[];
const PAGE = 60;

const AUTH_LABEL: Record<CatalogEntry["auth"], string> = {
  api_key: "API key",
  oauth2: "OAuth sign-in",
  none: "No key",
  webhook: "Webhook URL",
};

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI",
  crm: "CRM",
  iot: "IoT & home",
  geo: "Maps & weather",
  cms: "CMS",
};

export const categoryLabel = (id: string): string =>
  CATEGORY_LABEL[id] ?? id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function need<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`connectors: missing node ${selector}`);
  return node;
}

export function initConnectors(deps: Deps): void {
  (window as unknown as {__ULTRON_CONNECTOR_CATALOG__?:CatalogEntry[]}).__ULTRON_CONNECTOR_CATALOG__=CATALOG;
  const panel = need<HTMLElement>("#connectors-panel");
  const listEl = need<HTMLElement>("#connectors-list");
  const searchEl = need<HTMLInputElement>("#connectors-search");
  const chipsEl = need<HTMLElement>("#connectors-chips");
  const tiersEl = need<HTMLElement>("#connectors-tiers");
  const countEl = need<HTMLElement>("#connectors-count");
  const moreBtn = need<HTMLButtonElement>("#connectors-more");
  const refreshButton = need<HTMLButtonElement>("#connectors-refresh");
  const statusEl = need<HTMLElement>("#connectors-status");
  const permissionOverview = need<HTMLElement>("#permission-overview");
  const permissionCount = need<HTMLElement>("#permission-count");
  const permissionDescription = need<HTMLElement>("#permission-description");
  const composioHealth = need<HTMLElement>("#composio-health");
  const composioHealthLabel = need<HTMLElement>("#composio-health-label");
  const composioHealthDetail = need<HTMLElement>("#composio-health-detail");
  const composioKeyInput = need<HTMLInputElement>("#composio-api-key");
  const composioKeySave = need<HTMLButtonElement>("#composio-api-key-save");
  const composioKeyStatus = need<HTMLElement>("#composio-key-status");
  const mcpServerName = need<HTMLInputElement>("#mcp-server-name");
  const mcpServerUrl = need<HTMLInputElement>("#mcp-server-url");
  const mcpServerHeader = need<HTMLInputElement>("#mcp-server-header");
  const mcpServerToken = need<HTMLInputElement>("#mcp-server-token");
  const mcpServerAdd = need<HTMLButtonElement>("#mcp-server-add");
  const mcpServerStatus = need<HTMLElement>("#mcp-server-status");
  const mcpServerList = need<HTMLElement>("#mcp-server-list");
  const mcpAuditRefresh = need<HTMLButtonElement>("#mcp-audit-refresh");
  const mcpAuditStatus = need<HTMLElement>("#mcp-audit-status");
  const mcpAuditList = need<HTMLElement>("#mcp-audit-list");
  const detailWrap = need<HTMLElement>("#connector-detail-wrap");
  const detailEl = need<HTMLElement>("#connector-detail");
  const approvalPanel = need<HTMLElement>("#composio-approvals");
  const approvalList = need<HTMLElement>("#composio-approval-list");

  let cloudLinked = false;
  let category = "all";
  let tier: "all" | "free" | "paid" = "all";
  let shown = PAGE;
  let enabled = new Set<string>();
  let oauthConnected = new Set<string>();
  let remoteKnown = false;
  let detailReturnFocus: HTMLElement | null = null;
  let panelOpen = false;
  let refreshGeneration = 0;
  let refreshInFlight: { generation: number; promise: Promise<void> } | null = null;

  const setPermissionOverview = (state: "loading" | "empty" | "ready" | "error", count: number | null, description: string): void => {
    permissionOverview.dataset.state = state;
    permissionCount.textContent = count === null ? "—" : String(count);
    permissionDescription.textContent = description;
  };

  const categories = [...new Set(CATALOG.map((c) => c.category))].sort();

  const matches = (): CatalogEntry[] => {
    const needle = searchEl.value.trim().toLowerCase();
    return CATALOG.filter(
      (c) =>
        (category === "all" || c.category === category) &&
        (tier === "all" || c.tier === tier) &&
        (!needle ||
          c.id.includes(needle) ||
          c.name.toLowerCase().includes(needle) ||
          c.description.toLowerCase().includes(needle) ||
          c.actions.some((a) => a.includes(needle.replace(/\s+/g, "_")))),
    );
  };

  function card(entry: CatalogEntry): HTMLElement {
    const root = el("button", "conn-card");
    root.type = "button";
    root.setAttribute("aria-label", `${entry.name}, ${entry.tier}, ${AUTH_LABEL[entry.auth]}`);

    const head = el("div", "conn-head");
    const mark = el("span", "github-card-mark", entry.name.slice(0, 2).toUpperCase());
    mark.setAttribute("aria-hidden", "true");
    head.append(mark, el("span", "conn-name", entry.name));
    if (enabled.has(entry.id)) head.append(el("span", "conn-on", "On"));
    if (oauthConnected.has(entry.id.replace(/-/g, "_"))) head.append(el("span", "conn-on", "Connected"));
    root.append(head, el("p", "conn-desc", entry.description));

    const meta = el("div", "conn-meta");
    meta.append(el("span", "badge", categoryLabel(entry.category)));
    meta.append(el("span", `badge tier-${entry.tier}`, entry.tier === "free" ? "Free" : "Paid"));
    meta.append(el("span", "badge", AUTH_LABEL[entry.auth]));
    root.append(meta);

    root.addEventListener("click", () => openDetail(entry));
    return root;
  }

  function render(): void {
    const rows = matches();
    listEl.replaceChildren();
    if (rows.length === 0) {
      listEl.append(el("p", "conn-empty", "Nothing matches. Try another word or clear the filters."));
    } else {
      const frag = document.createDocumentFragment();
      for (const entry of rows.slice(0, shown)) frag.append(card(entry));
      listEl.append(frag);
    }
    countEl.textContent = `${rows.length} of ${CATALOG.length}`;
    moreBtn.hidden = rows.length <= shown;
    moreBtn.textContent = `Show ${Math.min(PAGE, rows.length - shown)} more`;
  }

  function reset(): void {
    shown = PAGE;
    render();
    listEl.scrollTop = 0;
  }

  function buildChips(): void {
    chipsEl.replaceChildren();
    const make = (id: string, label: string): void => {
      const b = el("button", "chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(category === id));
      b.addEventListener("click", () => {
        category = id;
        for (const other of chipsEl.querySelectorAll("button")) other.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-pressed", "true");
        reset();
      });
      chipsEl.append(b);
    };
    make("all", "All");
    for (const id of categories) make(id, categoryLabel(id));
  }

  function buildTiers(): void {
    tiersEl.replaceChildren();
    for (const [id, label] of [["all", "Any plan"], ["free", "Free"], ["paid", "Paid"]] as const) {
      const b = el("button", "chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(tier === id));
      b.addEventListener("click", () => {
        tier = id;
        for (const other of tiersEl.querySelectorAll("button")) other.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-pressed", "true");
        reset();
      });
      tiersEl.append(b);
    }
  }

  let mcpAuditTimer: number | null = null;
  async function refreshMcpAudit(): Promise<void> {
    if (!deps.backendLinked()) {
      mcpAuditStatus.textContent = "Link the ULTRON backend to inspect MCP activity.";
      mcpAuditList.replaceChildren(el("p", "conn-empty", "No backend activity source is connected."));
      return;
    }
    mcpAuditStatus.textContent = "Loading recent MCP calls…";
    try {
      const response = await deps.api("/v1/mcp/audit?limit=30", {}, 12_000);
      if (!response.ok) throw new Error("MCP audit returned " + response.status);
      const payload = await response.json() as { entries?: Array<Record<string,unknown>>; summary?: Record<string,unknown> };
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const summary = payload.summary ?? {};
      mcpAuditList.replaceChildren();
      if (!entries.length) mcpAuditList.append(el("p", "conn-empty", "No MCP tool calls recorded yet."));
      for (const entry of entries) {
        const row = el("article", "mcp-audit-row");
        const top = el("div", "mcp-audit-row-top");
        top.append(el("strong", undefined, String(entry.tool || "MCP tool")));
        top.append(el("span", entry.ok === true ? "mcp-audit-ok" : "mcp-audit-failed", entry.ok === true ? "Completed" : "Blocked / failed"));
        const reason = String(entry.reason || "No additional details");
        const caps = Array.isArray(entry.capabilities) ? entry.capabilities.map(String).join(", ") : "unspecified";
        const when = typeof entry.at === "string" ? new Date(entry.at).toLocaleTimeString() : "Time unavailable";
        row.append(top, el("small", undefined, reason.slice(0, 240)), el("small", "mcp-audit-meta", when + " · " + String(entry.latency_ms ?? 0) + " ms · " + caps));
        mcpAuditList.append(row);
      }
      mcpAuditStatus.textContent = String(summary.total ?? entries.length) + " calls retained in the backend audit store · " + String(summary.ok ?? 0) + " successful · " + String(summary.denied ?? 0) + " denied · last 30 shown.";
    } catch (error) {
      mcpAuditStatus.textContent = error instanceof Error ? error.message : "Could not load MCP activity.";
    }
  }

  type McpServerRow = { id:string; name?:string; transport?:string; state?:string; ready?:boolean; trust_level?:string; manifest_hash?:string; tools?:number; last_error?:string; last_seen?:string };
  async function refreshMcpServers(): Promise<void> {
    if (!deps.backendLinked()) {
      mcpServerStatus.textContent = "Link your ULTRON backend in Settings to manage remote MCP servers.";
      mcpServerList.replaceChildren(el("p", "conn-empty", "MCP management becomes available after the backend is connected."));
      return;
    }
    mcpServerStatus.textContent = "Loading your registered MCP servers…";
    try {
      const response = await deps.api("/v1/mcp/servers", {}, 12_000);
      if (!response.ok) throw new Error("MCP registry returned " + response.status);
      const payload = await response.json() as { servers?: McpServerRow[] };
      const servers = Array.isArray(payload.servers) ? payload.servers : [];
      mcpServerList.replaceChildren();
      if (!servers.length) mcpServerList.append(el("p", "conn-empty", "No MCP servers yet. Add one above to connect its tools to ULTRON."));
      for (const server of servers) {
        const card = el("article", "mcp-server-card");
        const heading = el("div", "mcp-server-card-head");
        const title = el("strong", undefined, server.name || server.id);
        const state = el("span", "badge", server.state || (server.ready ? "ready" : "registered"));
        state.dataset.state = server.state || (server.ready ? "ready" : "unknown");
        heading.append(title, state);
        const meta = el("small", "conn-note", (server.transport || "http").toUpperCase() + " · " + String(server.tools ?? 0) + " tools · " + (server.trust_level || "third_party") + " trust");
        card.append(heading, meta);
        if (server.manifest_hash) card.append(el("small", "conn-note", "Manifest " + server.manifest_hash.slice(0, 16)));
        if (server.last_error) card.append(el("p", "mcp-server-error", server.last_error));
        const actions = el("div", "mcp-server-actions");
        const inspect = el("button", "ghost", "Inspect tools");
        inspect.type = "button";
        inspect.addEventListener("click", async () => {
          inspect.disabled = true;
          try {
            const response = await deps.api("/v1/mcp/tools?server_id=" + encodeURIComponent(server.id) + "&limit=100", {}, 15_000);
            if (!response.ok) throw new Error("Tool index returned " + response.status);
            const body = await response.json() as { tools?: Array<Record<string, unknown>> };
            const tools = Array.isArray(body.tools) ? body.tools : [];
            const details = el("details", "mcp-server-tools");
            details.open = true;
            details.append(el("summary", "", tools.length + " discovered tools"));
            if (!tools.length) details.append(el("p", "conn-empty", "No tools were returned by this server."));
            for (const tool of tools) {
              const row = el("div", "mcp-server-tool");
              const toolName = el("strong", undefined, String(tool.id || tool.name || "Unnamed tool"));
              const description = el("small", undefined, String(tool.description || "No description supplied."));
              const annotations = tool.annotations && typeof tool.annotations === "object" ? tool.annotations as Record<string, unknown> : {};
              const caps = Array.isArray(annotations.capabilities) ? annotations.capabilities.map(String).join(", ") : "approval required by default";
              const capability = el("small", "mcp-tool-capabilities", caps);
              row.append(toolName, description, capability);
              details.append(row);
            }
            card.querySelector(".mcp-server-tools")?.remove();
            card.append(details);
          } catch (error) {
            mcpServerStatus.textContent = error instanceof Error ? error.message : "Could not inspect MCP tools.";
          } finally { inspect.disabled = false; }
        });
        const probe = el("button", "ghost", "Probe");
        probe.type = "button";
        probe.addEventListener("click", async () => {
          probe.disabled = true;
          mcpServerStatus.textContent = "Reconnecting to " + (server.name || server.id) + " and refreshing its tool manifest…";
          try {
            const response = await deps.api("/v1/mcp/servers/" + encodeURIComponent(server.id) + "/probe", { method: "POST" }, 30_000);
            if (!response.ok) throw new Error("Probe returned " + response.status);
            await refreshMcpServers();
            mcpServerStatus.textContent = "Probe finished. The server status and manifest are refreshed.";
          } catch (error) {
            mcpServerStatus.textContent = error instanceof Error ? error.message : "MCP probe failed.";
          } finally { probe.disabled = false; }
        });
        const remove = el("button", "ghost danger", "Remove");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!window.confirm("Remove MCP server " + (server.name || server.id) + "? Its tools will no longer be available.")) return;
          remove.disabled = true;
          try {
            const response = await deps.api("/v1/mcp/servers/" + encodeURIComponent(server.id), { method: "DELETE" }, 15_000);
            if (!response.ok && response.status !== 204) throw new Error("Remove returned " + response.status);
            await refreshMcpServers();
          } catch (error) {
            mcpServerStatus.textContent = error instanceof Error ? error.message : "Could not remove MCP server.";
            remove.disabled = false;
          }
        });
        actions.append(inspect, probe, remove);
        card.append(actions);
        mcpServerList.append(card);
      }
      mcpServerStatus.textContent = servers.length + " remote MCP server" + (servers.length === 1 ? "" : "s") + " registered. Live state and tool counts are shown below.";
    } catch (error) {
      mcpServerStatus.textContent = error instanceof Error ? error.message : "Could not load MCP servers.";
      mcpServerList.replaceChildren(el("p", "conn-empty", "The MCP registry could not be reached. Check your backend connection."));
    }
  }

  async function refreshEnabled(): Promise<void> {
    const generation = refreshGeneration;
    cloudLinked = await deps.linked();
    if (!cloudLinked && !deps.backendLinked()) {
      setPermissionOverview("empty", 0, "No permissions are granted. Ultron can browse the local connector catalogue, and asks only when you enable a capability.");
      remoteKnown = false;
      enabled = new Set();
      statusEl.textContent = "Browsing offline. Link your backend in Settings to enable connectors.";
      statusEl.dataset.tone = "";
      render();
      return;
    }
    setPermissionOverview("loading", null, "Checking granted capabilities. Nothing is assumed while the backend is being checked.");
    try {
      const connected = cloudLinked ? await listUltronConnectors() : { configured: false, connections: [] };
      if (!panelOpen || generation !== refreshGeneration) return;
      enabled = new Set(connected.connections.filter((item) => item.status === "connected").map((item) => item.provider_key));
      if (deps.backendLinked()) {
        const legacy = await deps.api("/v1/connectors/enabled/list", {}, 8_000);
        if (legacy.ok) {
          const body = await legacy.json() as { enabled?: unknown };
          if (Array.isArray(body.enabled)) for (const id of body.enabled) if (typeof id === "string") enabled.add(id);
        }
      }
      remoteKnown = true;
      statusEl.textContent = `${enabled.size} connected or enabled across your ULTRON gateway.`;
      statusEl.dataset.tone = "ok";
      const capabilityCount = CATALOG.filter((entry) => enabled.has(entry.id)).reduce((sum, entry) => sum + entry.actions.length, 0);
      setPermissionOverview(enabled.size > 0 ? "ready" : "empty", capabilityCount, enabled.size > 0 ? `${capabilityCount} catalog actions are available across ${enabled.size} connectors. Write actions remain disabled until you enable each exact tool.` : "No connector permissions are active. Connect only the services you need.");
    } catch {
      if (!panelOpen || generation !== refreshGeneration) return;
      // Never present a stale "On" badge as current backend state after a failed
      // refresh. The catalog remains browsable, but connection state is unknown.
      remoteKnown = false;
      enabled = new Set();
      statusEl.textContent = "Could not reach your backend. Showing the catalog only.";
      statusEl.dataset.tone = "bad";
      setPermissionOverview("error", null, "Permission state unavailable. Ultron will not display old grants as if they were current.");
    }
    render();
  }

  async function refreshOAuthConnections(): Promise<void> {
    const generation = refreshGeneration;
    oauthConnected = new Set();
    cloudLinked = await deps.linked();
    if (!cloudLinked) {
      composioHealth.dataset.state = "disconnected";
      composioHealthLabel.textContent = "Cloud account not connected";
      composioHealthDetail.textContent = "Sign in to the ULTRON owner account to manage provider connections.";
      return;
    }
    composioHealth.dataset.state = "loading";
    composioHealthLabel.textContent = "Checking connection";
    composioHealthDetail.textContent = "Checking connected provider accounts through the Supabase gateway.";
    try {
      const result = await listUltronConnectors();
      if (!panelOpen || generation !== refreshGeneration) return;
      for (const connection of result.connections) {
        if (connection.toolkit_slug && connection.status === "connected") oauthConnected.add(connection.toolkit_slug);
      }
      composioHealth.dataset.state = result.configured ? (oauthConnected.size ? "ready" : "disconnected") : "error";
      composioHealthLabel.textContent = result.configured ? (oauthConnected.size ? "Connected accounts ready" : "No connected accounts") : "Connector gateway not configured";
      composioHealthDetail.textContent = result.configured
        ? (oauthConnected.size ? `${oauthConnected.size} provider accounts are available through the central gateway.` : "The gateway is reachable. Connect a provider to make its tools available.")
        : "The Supabase gateway is reachable, but its Composio server credential is not configured.";
      composioKeyStatus.dataset.tone = result.configured ? "ok" : "";
      composioKeyStatus.textContent = result.configured
        ? "Composio API key is configured. Keys saved here are stored in Supabase Vault; you can replace the current key."
        : "Add your Composio API key here. It is verified first, stored in Vault, and cleared from this field.";
    } catch (error) {
      if (!panelOpen || generation !== refreshGeneration) return;
      composioHealth.dataset.state = "error";
      composioHealthLabel.textContent = "Connector gateway unavailable";
      composioHealthDetail.textContent = error instanceof Error ? error.message : "Could not load connected accounts.";
    }
  }

  async function refreshApprovals(): Promise<void> {
    const generation = refreshGeneration;
    approvalList.replaceChildren();
    approvalPanel.hidden = true;
    if (!deps.backendLinked()) return;
    try {
      const response = await deps.api("/v1/connectors/composio/approvals", {}, 10_000);
      if (!response.ok) return;
      const body = (await response.json()) as {
        approvals?: Array<{
          id: string;
          agent_id?: string;
          tool_name?: string;
          reason?: string;
          arguments?: Record<string, unknown>;
          expires_at?: string;
          capabilities?: string[];
        }>;
      };
      if (!panelOpen || generation !== refreshGeneration) return;
      const approvals = body.approvals ?? [];
      if (approvals.length === 0) return;
      approvalPanel.hidden = false;
      for (const approval of approvals) {
        const card = el("article", "approval-card");
        const heading = el("strong", "approval-title", approval.tool_name ?? "Requested action");
        const meta = el("small", "approval-meta",
          `Agent ${approval.agent_id ?? "unknown"} · ${(approval.capabilities ?? []).join(", ") || "permission review"}`);
        const reason = el("p", "approval-reason", approval.reason ?? "This action needs your approval.");
        const args = el("pre", "approval-args", JSON.stringify(approval.arguments ?? {}, null, 2));
        card.append(heading, meta, reason, args);
        const actions = el("div", "approval-actions");
        const deny = el("button", "ghost danger", "Deny");
        deny.type = "button";
        const approve = el("button", "solid", "Approve and run once");
        approve.type = "button";
        const decide = async (choice: "approve" | "deny"): Promise<void> => {
          deny.disabled = true;
          approve.disabled = true;
          try {
            const result = await deps.api(
              `/v1/connectors/composio/approvals/${encodeURIComponent(approval.id)}/${choice}`,
              { method: "POST" },
              25_000,
            );
            if (!result.ok) throw new Error(String(result.status));
            await refreshApprovals();
          } catch {
            meta.textContent = "Could not process this decision. Refresh and review it again.";
            deny.disabled = false;
            approve.disabled = false;
          }
        };
        deny.addEventListener("click", () => void decide("deny"));
        approve.addEventListener("click", () => void decide("approve"));
        actions.append(deny, approve);
        card.append(actions);
        approvalList.append(card);
      }
    } catch {
      // Approval UI is optional when Composio is not configured.
    }
  }

  /* ---------------- detail sheet ---------------- */

  function closeDetail(): void {
    detailWrap.hidden = true;
    detailEl.replaceChildren();
    const returnFocus = detailReturnFocus;
    detailReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function openDetail(entry: CatalogEntry): void {
    if (detailWrap.hidden) {
      detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    detailEl.replaceChildren();
    const on = enabled.has(entry.id);
    const toolkit = entry.id.replace(/-/g, "_");
    const oauthOn = oauthConnected.has(toolkit);

    const titleRow = el("div", "github-detail-title");
    const detailMark = el("span", "github-card-mark github-detail-mark", entry.name.slice(0, 2).toUpperCase());
    detailMark.setAttribute("aria-hidden", "true");
    titleRow.append(detailMark);
    const title = el("h2", undefined, entry.name);
    title.id = "connector-detail-title";
    titleRow.append(title);
    detailEl.setAttribute("aria-labelledby", title.id);
    detailEl.append(titleRow);
    detailEl.append(el("p", "conn-detail-desc", entry.description));

    const meta = el("div", "conn-meta");
    meta.append(el("span", "badge", categoryLabel(entry.category)));
    meta.append(el("span", `badge tier-${entry.tier}`, entry.tier === "free" ? "Free plan available" : "Paid plan required"));
    meta.append(el("span", "badge", AUTH_LABEL[entry.auth]));
    detailEl.append(meta);

    detailEl.append(el("div", "drawer-label", "AVAILABLE CAPABILITIES"));
    const actions = el("div", "github-capability-list");
    for (const a of entry.actions) {
      const row = el("div", "github-capability-row");
      row.append(el("span", "github-capability-check", "✓"), el("span", undefined, a));
      actions.append(row);
    }
    detailEl.append(actions);
    detailEl.append(el("p", "github-approval-note", entry.id === "googlesuper" ? "Security model: Google access is granted only through the Google authorization page. ULTRON never asks for your Google password. Read-only actions are available after consent. Write actions are disabled by default; enable each exact tool with Allow without asking to grant persistent access." : "Security model: connected account data is accessed only within the permissions you grant. Write actions are disabled by default. Enable each exact tool here and revoke it whenever you want."));

    const note = el("small", "conn-note");
    const buttons = el("div", "sheet-actions");
    let toolsStatus: HTMLElement | null = null;
    let toolsList: HTMLElement | null = null;
    let cachedTools: UltronConnectorTool[] = [];
let refreshAvailableTools: () => Promise<void> = async () => {};
let toolsSearch: HTMLInputElement | null = null;
const renderAvailableTools = (): void => {
  if (!toolsStatus || !toolsList) return;
  const query = toolsSearch?.value.trim().toLowerCase() ?? "";
  const matching = cachedTools.filter((tool) => !query || (tool.tool_slug + " " + tool.description).toLowerCase().includes(query));
  toolsList.replaceChildren();
  if (matching.length === 0) {
    toolsStatus.textContent = "No tools match that search.";
    return;
  }
  toolsStatus.textContent = cachedTools.length + " cloud tools available; " + matching.length + " match. Write tools are disabled until you enable each exact action below. Showing up to " + Math.min(40, matching.length) + ".";
  for (const tool of matching.slice(0, 40)) {
    const row = el("article", "github-capability-row");
    const details = el("div", "conn-tool-details");
    details.append(el("strong", "conn-tool-name", tool.tool_slug));
    details.append(el("p", "conn-tool-description", tool.description || "No description supplied by provider."));
    row.append(details);
    if (tool.read_only) {
      row.append(el("span", "badge", "Read-only"));
    } else {
      const permissionButton = el("button", tool.allowed ? "ghost danger" : "ghost", tool.allowed ? "Disable write access" : "Allow without asking");
      permissionButton.type = "button";
      permissionButton.addEventListener("click", async () => {
        const message = tool.allowed
          ? "Disable future executions of " + tool.tool_slug + "?"
          : "Allow ULTRON to run " + tool.tool_slug + " without asking each time? This is a persistent grant for this exact tool.";
        if (!window.confirm(message)) return;
        permissionButton.disabled = true;
        try {
          await setUltronConnectorToolPermission({ connectionId: tool.connection_id, toolSlug: tool.tool_slug, allow: !tool.allowed });
          await refreshAvailableTools();
        } catch (error) {
          toolsStatus!.textContent = error instanceof Error ? error.message : "Could not update tool permission.";
          permissionButton.disabled = false;
        }
      });
      row.append(permissionButton);
    }
    toolsList.append(row);
  }
};
refreshAvailableTools = async (): Promise<void> => {
  if (!toolsStatus || !toolsList) return;
  toolsStatus.textContent = "Loading tools from the ULTRON gateway…";
  toolsList.replaceChildren();
  try {
    const available = await listUltronConnectorTools(toolkit);
    cachedTools = available.filter((tool) => tool.toolkit_slug.replace(/-/g, "_") === toolkit);
    renderAvailableTools();
  } catch (error) {
    toolsStatus.textContent = error instanceof Error ? error.message : "Could not load tools from the ULTRON gateway.";
  }
};
if (entry.auth === "oauth2") {
  detailEl.append(el("div", "drawer-label", "CLOUD TOOLS"));
  toolsSearch = el("input", "conn-tool-search");
  toolsSearch.type = "search";
  toolsSearch.autocomplete = "off";
  toolsSearch.placeholder = "Search all tools by name or description";
  toolsSearch.addEventListener("input", renderAvailableTools);
  toolsStatus = el("small", "conn-note", oauthOn ? "Checking available tools…" : "Connect this provider to load its cloud tools.");
  toolsList = el("div", "github-capability-list");
  detailEl.append(toolsSearch, toolsStatus, toolsList);
  if (oauthOn) void refreshAvailableTools();
}
    const close = el("button", "ghost", "Close");
    close.type = "button";
    close.addEventListener("click", closeDetail);

    let keyInput: HTMLInputElement | null = null;
    if (entry.auth !== "none" && entry.auth !== "oauth2") {
      const field = el("label", "field");
      field.append(el("span", undefined, entry.auth === "webhook" ? "Webhook URL" : "API key"));
      keyInput = el("input");
      keyInput.type = "password";
      keyInput.autocomplete = "off";
      keyInput.spellcheck = false;
      keyInput.setAttribute("autocapitalize", "off");
      keyInput.placeholder = on ? "Paste a new value to replace it" : "Paste it here";
      field.append(keyInput);
      field.append(el("small", undefined, "Sent once to your backend's vault. It is not stored on this phone."));
      detailEl.append(field);
    }

    const canAct = entry.auth === "oauth2" ? cloudLinked : deps.backendLinked();
    if (!canAct) {
      note.textContent = "Link your Ultron backend in Settings to enable this connector.";
    }

    const act = el("button", "solid", entry.auth === "none" ? (on ? "Disable" : "Enable") : entry.auth === "oauth2" ? (oauthOn ? "Reconnect account" : "Connect account") : on ? "Update key" : "Connect");
    act.type = "button";
    act.disabled = !canAct;
    act.addEventListener("click", async () => {
      act.disabled = true;
      note.dataset.tone = "";
      note.textContent = "Working…";
      let preparedExternal: PreparedExternal | null = null;
      try {
        if (entry.auth === "oauth2") {
          // Browsers block window.open after an awaited fetch. Reserve the tab
          // synchronously inside this user gesture, then navigate it once the
          // server has returned Google's managed OAuth URL.
          preparedExternal = deps.prepareExternal?.() ?? null;
          const result = await startUltronConnectorConnection({ providerKey: entry.id.replace(/-/g, "_"), toolkitSlug: toolkit });
          if (preparedExternal) await preparedExternal.open(result.redirectUrl);
          else await deps.openExternal(result.redirectUrl);
          note.dataset.tone = "";
          note.textContent = "Waiting for " + entry.name + " authorization. Finish sign-in in the browser; this screen will update automatically.";
          void (async () => {
            const deadline = Date.now() + 120_000;
            let checks = 0;
            while (Date.now() < deadline && checks < 48 && panelOpen && !detailWrap.hidden) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
              if (document.visibilityState === "hidden" || !panelOpen || detailWrap.hidden) continue;
              checks++;
              try {
                const current = await refreshUltronConnectorStatus(result.connection.id);
                if (current.status === "connected") {
                  await refreshOAuthConnections();
                  await refreshEnabled();
                  await refreshAvailableTools();
                  note.dataset.tone = "ok";
                  note.textContent = entry.name + " connected. Its available tools are now loaded below.";
                  act.textContent = "Connected";
                  act.disabled = true;
                  return;
                }
                if (current.status === "error" || current.status === "refresh_required" || current.status === "revoked") {
                  note.dataset.tone = "bad";
                  note.textContent = current.last_error || "Authorization did not complete. Reconnect to try again.";
                  act.disabled = false;
                  return;
                }
                note.textContent = "Waiting for " + entry.name + " authorization… " + Math.min(checks * 2.5, 120) + "s";
              } catch (error) {
                note.textContent = "Still waiting for authorization. " + (error instanceof Error ? error.message : "Connection status will retry.");
              }
            }
            if (panelOpen && !detailWrap.hidden) {
              note.dataset.tone = "";
              note.textContent = "Authorization is still pending. Finish sign-in, then tap Refresh status if the account has not appeared.";
              act.disabled = false;
            }
          })();
          act.disabled = true;
          return;
        } else if (entry.auth === "none") {
          const res = await deps.api(`/v1/connectors/${encodeURIComponent(entry.id)}/${on ? "disable" : "enable"}`, { method: "POST" }, 15_000);
          if (!res.ok) throw new Error(`${res.status}`);
        } else {
          const value = keyInput?.value.trim() ?? "";
          if (value.length < 4) {
            note.dataset.tone = "bad";
            note.textContent = "That looks too short.";
            act.disabled = false;
            return;
          }
          // Clear the secret before the request yields control. A timeout or
          // backend error must not leave a credential sitting in the phone UI.
          if (keyInput) keyInput.value = "";
          const res = await deps.api("/v1/connectors/connect", {
            method: "POST",
            body: JSON.stringify({ connector_id: entry.id, api_key: value, plan: entry.tier }),
          }, 20_000);
          if (!res.ok) throw new Error(`${res.status}`);
        }
        await refreshEnabled();
        await refreshOAuthConnections();
        closeDetail();
      } catch (error) {
        preparedExternal?.cancel();
        note.dataset.tone = "bad";
        note.textContent = `Could not complete that (${error instanceof Error ? error.message : "error"}).`;
        act.disabled = false;
      }
    });

    buttons.append(close);
    if (entry.auth === "oauth2") {
      const refresh = el("button", "ghost", oauthOn ? "Refresh status" : "Check connection");
      refresh.type = "button";
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        const rows = await listUltronConnectors();
        const matching = rows.connections.filter((item) => item.toolkit_slug === toolkit && item.status !== "revoked");
        for (const item of matching) await refreshUltronConnectorStatus(item.id);
        await refreshOAuthConnections();
        const nowConnected = oauthConnected.has(toolkit);
        if (nowConnected) await refreshAvailableTools();
        note.dataset.tone = nowConnected ? "ok" : "";
        note.textContent = nowConnected ? "Account connected and ready." : "No active connection found yet. Finish authorization in the browser first.";
        refresh.disabled = false;
      });
      buttons.append(refresh);
    }
    if (oauthOn) {
      const off = el("button", "ghost danger", "Disconnect account");
      off.type = "button";
      off.addEventListener("click", async () => {
        off.disabled = true;
        try {
          const rows = await listUltronConnectors();
          const matches = rows.connections.filter((item) => item.toolkit_slug === toolkit && item.status !== "revoked");
          for (const item of matches) await disconnectUltronConnector(item.id);
          await refreshOAuthConnections();
          await refreshEnabled();
          closeDetail();
        } catch (error) {
          note.dataset.tone = "bad";
          note.textContent = error instanceof Error ? error.message : "Could not disconnect account.";
          off.disabled = false;
        }
      });
      buttons.append(off);
    }
    if (on && entry.auth !== "none" && entry.auth !== "oauth2") {
      const off = el("button", "ghost danger", "Disable");
      off.type = "button";
      off.disabled = !canAct;
      off.addEventListener("click", async () => {
        off.disabled = true;
        try {
          const res = await deps.api(`/v1/connectors/${encodeURIComponent(entry.id)}/disable`, { method: "POST" }, 15_000);
          if (!res.ok) throw new Error(`${res.status}`);
          await refreshEnabled();
          closeDetail();
        } catch {
          note.dataset.tone = "bad";
          note.textContent = "Could not disable it.";
          off.disabled = false;
        }
      });
      buttons.append(off);
    }
    buttons.append(act);
    detailEl.append(buttons, note);
    detailWrap.hidden = false;
    // Put keyboard and screen-reader focus inside the modal as soon as it opens.
    (keyInput ?? close).focus();
  }

  /* ---------------- open / close ---------------- */

  function refreshAll(): Promise<void> {
    const generation = refreshGeneration;
    if (refreshInFlight?.generation === generation) return refreshInFlight.promise;
    refreshButton.disabled = true;
    refreshButton.textContent = "Checking…";
    const promise = Promise.allSettled([refreshEnabled(), refreshOAuthConnections(), refreshApprovals(), refreshMcpServers(), refreshMcpAudit()]).then(() => {
      if (panelOpen && generation === refreshGeneration) render();
    }).finally(() => {
      if (refreshInFlight?.promise !== promise) return;
      refreshInFlight = null;
      if (generation === refreshGeneration) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh status";
      }
    });
    refreshInFlight = { generation, promise };
    return promise;
  }

  function open(): void {
    deps.closeDrawer();
    panelOpen = true;
    refreshGeneration++;
    panel.hidden = false;
    if (mcpAuditTimer !== null) window.clearInterval(mcpAuditTimer);
    mcpAuditTimer = window.setInterval(() => { if (panelOpen && !document.hidden) void refreshMcpAudit(); }, 5000);
    document.body.dataset.panel = "connectors";
    void refreshAll();
  }

  function close(): void {
    panelOpen = false;
    refreshGeneration++;
    if (mcpAuditTimer !== null) { window.clearInterval(mcpAuditTimer); mcpAuditTimer = null; }
    closeDetail();
    panel.hidden = true;
    delete document.body.dataset.panel;
  }

  mcpServerAdd.addEventListener("click", async () => {
    const name = mcpServerName.value.trim();
    const endpoint = mcpServerUrl.value.trim();
    const token = mcpServerToken.value.trim();
    const headerName = mcpServerHeader.value.trim() || "Authorization";
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { mcpServerStatus.textContent = "Enter a valid HTTPS MCP endpoint."; return; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname || parsed.hash || parsed.search || (parsed.port !== "" && parsed.port !== "443")) {
      mcpServerStatus.textContent = "Use a public HTTPS endpoint on port 443 without embedded credentials, query parameters or URL fragments. Put bearer tokens in the separate token field.";
      return;
    }
    if (token && !/^[A-Za-z0-9-]{1,64}$/.test(headerName)) { mcpServerStatus.textContent = "Use a simple HTTP header name such as Authorization or X-API-Key."; mcpServerHeader.focus(); return; }
    if (!name) { mcpServerStatus.textContent = "Give this MCP server a name first."; mcpServerName.focus(); return; }
    const id = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").slice(0, 48);
    if (!id) { mcpServerStatus.textContent = "Choose a name containing letters or numbers."; return; }
    mcpServerAdd.disabled = true;
    mcpServerStatus.textContent = "Registering " + name + " and performing the MCP handshake…";
    const headers: Record<string,string> = {};
    if (token) headers[headerName] = headerName.toLowerCase() === "authorization" ? "Bearer " + token : token;
    mcpServerToken.value = "";
    try {
      const response = await deps.api("/v1/mcp/servers", {
        method: "POST",
        body: JSON.stringify({
          id, name, transport: "http", url: parsed.toString(), headers,
          trust_level: "third_party", enabled: true, connect: true,
          timeout_s: 30, connect_timeout_s: 10,
          egress: { allowed_hosts: [parsed.hostname], deny_private: true, byte_cap: 8388608, request_cap: 128 },
          capabilities: [], description: "Owner-registered remote MCP server"
        })
      }, 35_000);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string,unknown>;
        throw new Error(String(body.detail || body.message || "MCP registration failed (" + response.status + ")"));
      }
      mcpServerName.value = "";
      mcpServerUrl.value = "";
      mcpServerStatus.textContent = "MCP server registered. Checking its discovered tools…";
      await refreshMcpServers();
    } catch (error) {
      mcpServerStatus.textContent = error instanceof Error ? error.message : "Could not register MCP server.";
    } finally { mcpServerAdd.disabled = false; }
  });

  composioKeySave.addEventListener("click", async () => {
    const value = composioKeyInput.value.trim();
    if (!value) {
      composioKeyStatus.dataset.tone = "bad";
      composioKeyStatus.textContent = "Paste your Composio API key first.";
      composioKeyInput.focus();
      return;
    }
    composioKeySave.disabled = true;
    composioKeyStatus.dataset.tone = "";
    composioKeyStatus.textContent = "Verifying the key with Composio and saving it to Vault…";
    try {
      await saveUltronComposioApiKey(value);
      composioKeyInput.value = "";
      composioKeyStatus.dataset.tone = "ok";
      composioKeyStatus.textContent = "Verified and saved securely. The key was cleared from this screen.";
      await refreshOAuthConnections();
    } catch (error) {
      composioKeyStatus.dataset.tone = "bad";
      composioKeyStatus.textContent = error instanceof Error ? error.message : "Could not verify and save the Composio key.";
    } finally {
      composioKeySave.disabled = false;
    }
  });
    refreshButton.addEventListener("click", () => void refreshAll());
  mcpAuditRefresh.addEventListener("click", () => void refreshMcpAudit());
  need<HTMLButtonElement>("#connectors-btn").addEventListener("click", open);
  need<HTMLButtonElement>("#connectors-back").addEventListener("click", close);
  detailWrap.addEventListener("click", (event) => {
    if (event.target === detailWrap) closeDetail();
  });
  detailWrap.addEventListener("keydown", (event) => {
    if (detailWrap.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...detailEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      detailEl.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // Array indexing remains optional under noUncheckedIndexedAccess, even
    // after the length guard. Keep the focus trap defensive for empty DOMs.
    if (!first || !last) {
      event.preventDefault();
      detailEl.focus();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || !detailEl.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  moreBtn.addEventListener("click", () => {
    shown += PAGE;
    render();
  });
  let timer = 0;
  searchEl.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(reset, 120);
  });

  buildChips();
  buildTiers();
  render();
  void remoteKnown;
}
