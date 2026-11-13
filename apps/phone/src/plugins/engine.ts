import { Capacitor, registerPlugin } from "@capacitor/core";
import { GOOGLE_EMAIL_SCOPE, GoogleApiError, PLUGIN_CATALOG, pluginById, type PluginDefinition } from "./catalog";

export type GoogleAuth = { authorize(options: { scopes: string[] }): Promise<{ accessToken: string; grantedScopes: string[] }> };
export type InstalledPlugin = { id: string; installedAt: string; account: string };
export type PluginToolInfo = { plugin_id: string; display_name: string; tool_slug: string; description: string; input_parameters: unknown; read_only: boolean };

export class PluginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "PluginError"; this.code = code; }
}

const STORE_KEY = "ultron.plugins.v1";
const TOKEN_TTL_MS = 45 * 60_000;
const MAX_RESULT_CHARS = 24_000;

type EngineDeps = {
  auth: GoogleAuth;
  fetchImpl: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem">;
  platform: () => string;
  now: () => number;
};

function describeNativeError(error: unknown): PluginError {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "failed";
  const message = error instanceof Error && error.message ? error.message : "Google authorization failed.";
  if (/not implemented|unimplemented/i.test(message)) return new PluginError("unavailable", "Google sign-in is only available in the Android app.");
  return new PluginError(code, message);
}

function friendlyApiError(plugin: PluginDefinition, error: GoogleApiError): PluginError {
  if (error.status === 401) return new PluginError("reauth", `Google rejected the ${plugin.name} access token. Open Plugins and reconnect ${plugin.name}.`);
  if (error.status === 403) return new PluginError("forbidden", `Google refused the ${plugin.name} request: ${error.message} If this says the API has not been used or is disabled, enable it in the Google Cloud project that owns this app's OAuth client.`);
  if (error.status === 429) return new PluginError("rate_limited", `Google is rate limiting ${plugin.name} right now. Try again shortly.`);
  return new PluginError("api_error", `${plugin.name} request failed: ${error.message}`);
}

export function createPluginEngine(deps: EngineDeps) {
  const tokens = new Map<string, { token: string; expires: number }>();

  const readStore = (): Record<string, InstalledPlugin> => {
    try {
      const parsed = JSON.parse(deps.storage.getItem(STORE_KEY) ?? "{}") as Record<string, InstalledPlugin>;
      return parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed).filter(([id, v]) => pluginById(id) && v && typeof v.account === "string")) : {};
    } catch { return {}; }
  };
  const writeStore = (value: Record<string, InstalledPlugin>): void => { try { deps.storage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* storage full or blocked */ } };

  const scopesFor = (plugin: PluginDefinition): string[] => [GOOGLE_EMAIL_SCOPE, ...plugin.scopes];

  async function accessToken(plugin: PluginDefinition): Promise<string> {
    const scopes = scopesFor(plugin);
    const key = scopes.join(" ");
    const cached = tokens.get(key);
    if (cached && cached.expires > deps.now()) return cached.token;
    if (deps.platform() !== "android") throw new PluginError("unavailable", "Google sign-in is only available in the Android app.");
    let result: { accessToken: string; grantedScopes: string[] };
    try { result = await deps.auth.authorize({ scopes }); } catch (error) { throw describeNativeError(error); }
    const missing = plugin.scopes.filter((scope) => !result.grantedScopes.includes(scope));
    if (missing.length) throw new PluginError("partial", `${plugin.name} needs every permission it asks for. You allowed only part of them; connect again and leave all boxes ticked.`);
    tokens.set(key, { token: result.accessToken, expires: deps.now() + TOKEN_TTL_MS });
    return result.accessToken;
  }

  async function accountEmail(token: string): Promise<string> {
    const response = await deps.fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return "";
    const body = await response.json().catch(() => ({})) as { email?: string };
    return typeof body.email === "string" ? body.email : "";
  }

  return {
    catalog: (): readonly PluginDefinition[] => PLUGIN_CATALOG,
    installed: (): InstalledPlugin[] => Object.values(readStore()),
    isInstalled: (id: string): boolean => Boolean(readStore()[id]),

    /** Tap a plugin: Google shows its consent sheet once, then the plugin is connected until it is removed. */
    async install(id: string): Promise<InstalledPlugin> {
      const plugin = pluginById(id);
      if (!plugin) throw new PluginError("unknown_plugin", "That plugin is not in the catalogue.");
      const token = await accessToken(plugin);
      const account = await accountEmail(token);
      const entry: InstalledPlugin = { id, installedAt: new Date(deps.now()).toISOString(), account };
      writeStore({ ...readStore(), [id]: entry });
      return entry;
    },

    /** Removes the plugin. When it was the last one, the Google grant itself is revoked as well. */
    async remove(id: string): Promise<{ revoked: boolean }> {
      const store = readStore();
      const plugin = pluginById(id);
      if (!plugin || !store[id]) return { revoked: false };
      delete store[id];
      writeStore(store);
      tokens.delete(scopesFor(plugin).join(" "));
      if (Object.keys(store).length > 0) return { revoked: false };
      let revoked = false;
      try {
        const token = await accessToken(plugin);
        const response = await deps.fetchImpl("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `token=${encodeURIComponent(token)}` });
        revoked = response.ok;
      } catch { /* the plugin is already removed locally; the user can finish at myaccount.google.com/permissions */ }
      tokens.clear();
      return { revoked };
    },

    tools(pluginId?: string): PluginToolInfo[] {
      const store = readStore();
      return PLUGIN_CATALOG.filter((p) => store[p.id] && (!pluginId || p.id === pluginId)).flatMap((p) =>
        p.tools.map((t) => ({ plugin_id: p.id, display_name: p.name, tool_slug: t.slug, description: t.description, input_parameters: t.parameters, read_only: t.readOnly })));
    },

    async run(pluginId: string, toolSlug: string, args: Record<string, unknown> = {}): Promise<unknown> {
      const plugin = pluginById(pluginId);
      if (!plugin) throw new PluginError("unknown_plugin", `Unknown plugin "${pluginId}".`);
      if (!readStore()[pluginId]) throw new PluginError("not_installed", `${plugin.name} is not connected. Open Plugins and connect it first.`);
      const tool = plugin.tools.find((t) => t.slug === toolSlug);
      if (!tool) throw new PluginError("unknown_tool", `${plugin.name} has no tool called ${toolSlug}.`);
      const token = await accessToken(plugin);
      try {
        const result = await tool.run(args, { token, fetch: deps.fetchImpl });
        const text = JSON.stringify(result);
        return text.length > MAX_RESULT_CHARS ? { truncated: true, preview: text.slice(0, MAX_RESULT_CHARS) } : result;
      } catch (error) {
        if (error instanceof GoogleApiError) {
          if (error.status === 401) tokens.clear();
          throw friendlyApiError(plugin, error);
        }
        throw error;
      }
    },
  };
}

const nativeAuth = registerPlugin<GoogleAuth>("UltronGoogleAuth");
export const pluginEngine = createPluginEngine({
  auth: nativeAuth,
  fetchImpl: (...args) => fetch(...args),
  storage: window.localStorage,
  platform: () => Capacitor.getPlatform(),
  now: () => Date.now(),
});
