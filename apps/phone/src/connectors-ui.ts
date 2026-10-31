/**
 * Connectors screen.
 *
 * The catalog ships inside the app (`connectors.catalog.json`, generated from the
 * backend catalog by `ultran-backend/tools/export_catalog.py`), so the full list
 * is browsable with no network. Enabling and connecting go to the linked Ultran
 * backend; with no endpoint set the screen is read-only and says so.
 *
 * Secrets: a key typed here is sent once to the backend vault and cleared from
 * the field immediately. It is never written to local storage.
 */

import catalogJson from "./connectors.catalog.json";

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
  linked: () => boolean;
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
  const panel = need<HTMLElement>("#connectors-panel");
  const listEl = need<HTMLElement>("#connectors-list");
  const searchEl = need<HTMLInputElement>("#connectors-search");
  const chipsEl = need<HTMLElement>("#connectors-chips");
  const tiersEl = need<HTMLElement>("#connectors-tiers");
  const countEl = need<HTMLElement>("#connectors-count");
  const moreBtn = need<HTMLButtonElement>("#connectors-more");
  const statusEl = need<HTMLElement>("#connectors-status");
  const detailWrap = need<HTMLElement>("#connector-detail-wrap");
  const detailEl = need<HTMLElement>("#connector-detail");

  let category = "all";
  let tier: "all" | "free" | "paid" = "all";
  let shown = PAGE;
  let enabled = new Set<string>();
  let oauthConnected = new Set<string>();
  let remoteKnown = false;
  let detailReturnFocus: HTMLElement | null = null;

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
    head.append(el("span", "conn-name", entry.name));
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
    if (!deps.linked()) {
      remoteKnown = false;
      enabled = new Set();
      statusEl.textContent = "Browsing offline. Link your backend in Settings to enable connectors.";
      statusEl.dataset.tone = "";
      render();
      return;
    }
    try {
      const res = await deps.api("/v1/connectors/enabled/list", {}, 8_000);
      if (!res.ok) throw new Error(String(res.status));
      const body: unknown = await res.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("enabled" in body) ||
        !Array.isArray(body.enabled) ||
        !body.enabled.every((id): id is string => typeof id === "string")
      ) {
        throw new Error("Invalid enabled-connectors response");
      }
      enabled = new Set(body.enabled);
      remoteKnown = true;
      statusEl.textContent = `${enabled.size} enabled on your backend.`;
      statusEl.dataset.tone = "ok";
    } catch {
      // Never present a stale "On" badge as current backend state after a failed
      // refresh. The catalog remains browsable, but connection state is unknown.
      remoteKnown = false;
      enabled = new Set();
      statusEl.textContent = "Could not reach your backend. Showing the catalog only.";
      statusEl.dataset.tone = "bad";
    }
    render();
  }

  async function refreshOAuthConnections(): Promise<void> {
    oauthConnected = new Set();
    if (!deps.linked()) return;
    try {
      const status = await deps.api("/v1/connectors/composio/status", {}, 8_000);
      if (!status.ok) return;
      const configured = (await status.json()) as { configured?: boolean };
      if (!configured.configured) return;
      const response = await deps.api("/v1/connectors/composio/connections", {}, 12_000);
      if (!response.ok) return;
      const body = (await response.json()) as { connections?: Array<{ toolkit?: string; status?: string }> };
      for (const account of body.connections ?? []) {
        if (account.toolkit && account.status === "ACTIVE") oauthConnected.add(account.toolkit);
      }
    } catch {
      // A disconnected Composio service must not break the offline catalogue.
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

    const title = el("h2", undefined, entry.name);
    title.id = "connector-detail-title";
    detailEl.setAttribute("aria-labelledby", title.id);
    detailEl.append(title);
    detailEl.append(el("p", "conn-detail-desc", entry.description));

    const meta = el("div", "conn-meta");
    meta.append(el("span", "badge", categoryLabel(entry.category)));
    meta.append(el("span", `badge tier-${entry.tier}`, entry.tier === "free" ? "Free plan available" : "Paid plan required"));
    meta.append(el("span", "badge", AUTH_LABEL[entry.auth]));
    detailEl.append(meta);

    detailEl.append(el("div", "drawer-label", `Actions (${entry.actions.length})`));
    const actions = el("div", "conn-actions");
    for (const a of entry.actions) actions.append(el("code", "action", a));
    detailEl.append(actions);

    const note = el("small", "conn-note");
    const buttons = el("div", "sheet-actions");

    const close = el("button", "ghost", "Close");
    close.type = "button";
    close.addEventListener("click", closeDetail);

    let keyInput: HTMLInputElement | null = null;
    if (entry.auth !== "none" && entry.auth !== "oauth2") {
      const field = el("label", "field");
      field.append(el("span", undefined, AUTH_LABEL[entry.auth] === "Webhook URL" ? "Webhook URL" : entry.auth === "oauth2" ? "Access token" : "API key"));
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

    const canAct = deps.linked();
    if (!canAct) {
      note.textContent = "Link your Ultran backend in Settings to enable this connector.";
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
          const res = await deps.api(`/v1/connectors/composio/authorize/${encodeURIComponent(toolkit)}`, { method: "POST" }, 15_000);
          if (!res.ok) throw new Error(`${res.status}`);
          const body = (await res.json()) as { redirect_url?: string };
          if (!body.redirect_url || !body.redirect_url.startsWith("https://")) throw new Error("Invalid authorization link");
          await deps.openExternal(body.redirect_url);
          note.textContent = "Complete sign-in in your browser, return to Ultran, then refresh the connection status.";
          act.disabled = false;
          return;
        } else if (entry.auth === "none") {
          const res = await deps.api(`/v1/connectors/${encodeURIComponent(entry.id)}/${on ? "disable" : "enable"}`, { method: "POST" });
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
          });
          if (!res.ok) throw new Error(`${res.status}`);
        }
        await refreshEnabled();
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
        await refreshOAuthConnections();
        const nowConnected = oauthConnected.has(toolkit);
        note.dataset.tone = nowConnected ? "ok" : "";
        note.textContent = nowConnected ? "Account connected and ready." : "No active connection found yet. Finish authorization in the browser first.";
        refresh.disabled = false;
      });
      buttons.append(refresh);
    }
    if (on && entry.auth !== "none") {
      const off = el("button", "ghost danger", "Disable");
      off.type = "button";
      off.disabled = !canAct;
      off.addEventListener("click", async () => {
        off.disabled = true;
        try {
          const res = await deps.api(`/v1/connectors/${encodeURIComponent(entry.id)}/disable`, { method: "POST" });
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

  function open(): void {
    deps.closeDrawer();
    panel.hidden = false;
    document.body.dataset.panel = "connectors";
    void refreshEnabled();
    void refreshOAuthConnections().then(render);
  }

  function close(): void {
    closeDetail();
    panel.hidden = true;
    delete document.body.dataset.panel;
  }

  need<HTMLButtonElement>("#connectors-btn").addEventListener("click", open);
  need<HTMLButtonElement>("#connectors-back").addEventListener("click", close);
  detailWrap.addEventListener("click", (event) => {
    if (event.target === detailWrap) closeDetail();
  });
  detailWrap.addEventListener("keydown", (event) => {
    if (detailWrap.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
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
