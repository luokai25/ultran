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
import { listUltronConnectors, listUltronConnectorTools, startUltronConnectorConnection, refreshUltronConnectorStatus, disconnectUltronConnector } from "./connectors-cloud";

export type CatalogEntry = {
  id: string;
  name: string;
  category: string;
  auth: "api_key" | "oauth2" | "none" | "webhook";
  tier: "free" | "paid";
  actions: string[];
  description: string;
};

type Deps = {
  /** True when a brain endpoint is linked. */
  linked: () => Promise<boolean>;
  backendLinked: () => boolean;
  api: (path: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  closeDrawer: () => void;
  openExternal: (url: string) => Promise<void>;
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
    const mark = el("span", "github-card-mark", "GH");
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
      setPermissionOverview(enabled.size > 0 ? "ready" : "empty", capabilityCount, enabled.size > 0 ? `${capabilityCount} catalog actions are available across ${enabled.size} connectors. Write-capable actions still require approval.` : "No connector permissions are active. Connect only the services you need.");
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
    const detailMark = el("span", "github-card-mark github-detail-mark", "GH");
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
    detailEl.append(el("p", "github-approval-note", "Security model: repository data is read through the connected account. Any operation that changes GitHub requires a separate approval showing the exact repository and action."));

    const note = el("small", "conn-note");
    const buttons = el("div", "sheet-actions");
    let toolsStatus: HTMLElement | null = null;
    let toolsList: HTMLElement | null = null;
    const refreshAvailableTools = async (): Promise<void> => {
      if (!toolsStatus || !toolsList) return;
      toolsStatus.textContent = "Loading tools from the ULTRON gateway…";
      toolsList.replaceChildren();
      try {
        const available = await listUltronConnectorTools(toolkit);
        const matching = available.filter((tool) => tool.toolkit_slug.replace(/-/g, "_") === toolkit);
        if (matching.length === 0) {
          toolsStatus.textContent = "No executable tools were returned for this connected provider.";
          return;
        }
        toolsStatus.textContent = `${matching.length} cloud tools available to ULTRON's agent runtime.`;
        for (const tool of matching) {
          const row = el("article", "github-capability-row");
          const details = el("div", "conn-tool-details");
          details.append(el("strong", "conn-tool-name", tool.tool_slug));
          details.append(el("p", "conn-tool-description", tool.description || "No description supplied by provider."));
          row.append(details);
          toolsList.append(row);
        }
      } catch (error) {
        toolsStatus.textContent = error instanceof Error ? error.message : "Could not load tools from the ULTRON gateway.";
      }
    };
    if (entry.auth === "oauth2") {
      detailEl.append(el("div", "drawer-label", "CLOUD TOOLS"));
      toolsStatus = el("small", "conn-note", oauthOn ? "Checking available tools…" : "Connect this provider to load its cloud tools.");
      toolsList = el("div", "github-capability-list");
      detailEl.append(toolsStatus, toolsList);
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
      try {
        if (entry.auth === "oauth2") {
          const result = await startUltronConnectorConnection({ providerKey: entry.id.replace(/-/g, "_"), toolkitSlug: toolkit });
          await deps.openExternal(result.redirectUrl);
          note.textContent = "Complete provider authorization in your browser, then return here to refresh the connection.";
          act.disabled = false;
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
    const promise = Promise.allSettled([refreshEnabled(), refreshOAuthConnections(), refreshApprovals()]).then(() => {
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
    document.body.dataset.panel = "connectors";
    void refreshAll();
  }

  function close(): void {
    panelOpen = false;
    refreshGeneration++;
    closeDetail();
    panel.hidden = true;
    delete document.body.dataset.panel;
  }

  refreshButton.addEventListener("click", () => void refreshAll());
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
