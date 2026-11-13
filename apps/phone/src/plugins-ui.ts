/**
 * Plugins screen. Tap a plugin, approve Google's consent sheet once, and it stays connected on this device
 * until the plugin is removed. All state lives on the phone; there is no ULTRON server behind this screen.
 */
import { pluginEngine, PluginError } from "./plugins/engine";
import type { PluginDefinition } from "./plugins/catalog";

function need<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Plugins screen: missing ${selector}`);
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(plugin: PluginDefinition): HTMLElement {
  const node = el("span", "plug-tile", plugin.glyph);
  node.style.setProperty("--plug-accent", plugin.accent);
  node.setAttribute("aria-hidden", "true");
  return node;
}

export function initPlugins(): void {
  const list = need<HTMLElement>("#connectors-list");
  const search = need<HTMLInputElement>("#connectors-search");
  const count = need<HTMLElement>("#connectors-count");
  const status = need<HTMLElement>("#connectors-status");
  const wrap = need<HTMLElement>("#connector-detail-wrap");
  const sheet = need<HTMLElement>("#connector-detail");
  let busyId: string | null = null;
  let openId: string | null = null;

  const say = (message: string, tone: "info" | "error" = "info"): void => { status.textContent = message; status.dataset.tone = tone; };

  function closeSheet(): void { wrap.hidden = true; openId = null; sheet.replaceChildren(); }

  async function connect(plugin: PluginDefinition): Promise<void> {
    if (busyId) return;
    busyId = plugin.id;
    say(`Opening Google for ${plugin.name}…`);
    render();
    try {
      const entry = await pluginEngine.install(plugin.id);
      say(`${plugin.name} connected${entry.account ? ` as ${entry.account}` : ""}. It stays connected until you remove it.`);
    } catch (error) {
      if (error instanceof PluginError && error.code === "cancelled") say(`${plugin.name} was not connected: Google sign-in was cancelled.`);
      else say(error instanceof Error ? error.message : `Could not connect ${plugin.name}.`, "error");
    } finally { busyId = null; render(); }
  }

  async function remove(plugin: PluginDefinition): Promise<void> {
    if (busyId) return;
    busyId = plugin.id;
    render();
    try {
      const { revoked } = await pluginEngine.remove(plugin.id);
      say(revoked ? `${plugin.name} removed and ULTRON's Google access revoked.` : `${plugin.name} removed from ULTRON.`);
    } catch (error) {
      say(error instanceof Error ? error.message : `Could not remove ${plugin.name}.`, "error");
    } finally { busyId = null; render(); }
  }

  function renderSheet(plugin: PluginDefinition): void {
    const installed = pluginEngine.installed().find((p) => p.id === plugin.id);
    const busy = busyId === plugin.id;
    const head = el("div", "plug-sheet-head");
    head.append(tile(plugin));
    const titles = el("div");
    titles.append(el("h2", undefined, plugin.name), el("small", undefined, installed ? (installed.account ? `Connected as ${installed.account}` : "Connected") : plugin.tagline));
    const close = el("button", "icon-btn", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeSheet);
    head.append(titles, close);

    const about = el("p", "plug-about", plugin.description);
    const toolsTitle = el("h3", "plug-section", "What ULTRON can do");
    const tools = el("ul", "plug-tools");
    for (const tool of plugin.tools) {
      const item = el("li");
      item.append(el("span", tool.readOnly ? "plug-badge read" : "plug-badge write", tool.readOnly ? "Reads" : "Changes data · asks first"), el("span", undefined, tool.description));
      tools.append(item);
    }
    const note = el("p", "plug-note", installed
      ? "Connected until you remove it. Google keeps the permission, and ULTRON asks Google for a fresh key each time, so nothing sensitive is stored in the app. Removing the last Google plugin also revokes ULTRON's Google access."
      : "Google will show a consent screen once. Approve it and this plugin stays connected until you remove it.");
    const action = el("button", installed ? "ghost danger" : "solid plug-cta", busy ? "Working…" : installed ? "Remove plugin" : "Connect with Google");
    action.type = "button";
    action.disabled = busy;
    action.addEventListener("click", () => void (installed ? remove(plugin) : connect(plugin)));
    sheet.replaceChildren(head, about, toolsTitle, tools, note, action);
    wrap.hidden = false;
    openId = plugin.id;
  }

  function render(): void {
    const needle = search.value.trim().toLowerCase();
    const installedIds = new Set(pluginEngine.installed().map((p) => p.id));
    const plugins = pluginEngine.catalog().filter((p) => !needle || `${p.name} ${p.tagline} ${p.description}`.toLowerCase().includes(needle));
    count.textContent = `${installedIds.size} connected`;
    list.replaceChildren();
    if (!plugins.length) list.append(el("p", "conn-empty", "No plugins match your search."));
    for (const plugin of plugins) {
      const connected = installedIds.has(plugin.id);
      const busy = busyId === plugin.id;
      const card = el("button", "plug-card");
      card.type = "button";
      card.dataset.plugin = plugin.id;
      const body = el("span", "plug-card-body");
      body.append(el("strong", undefined, plugin.name), el("small", undefined, plugin.tagline));
      const chip = el("span", connected ? "plug-chip on" : "plug-chip", busy ? "Working…" : connected ? "Connected" : "Connect");
      card.append(tile(plugin), body, chip);
      card.addEventListener("click", () => renderSheet(plugin));
      list.append(card);
    }
    if (openId) { const open = pluginEngine.catalog().find((p) => p.id === openId); if (open) renderSheet(open); }
  }

  search.addEventListener("input", render);
  wrap.addEventListener("click", (event) => { if (event.target === wrap) closeSheet(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !wrap.hidden && openId) closeSheet(); });
  render();
}
