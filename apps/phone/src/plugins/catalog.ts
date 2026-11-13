/**
 * ULTRON plugin catalogue. Every plugin runs on this device: it asks Google for consent once through the native
 * Identity Authorization API and then calls Google's REST APIs directly. There is no ULTRON server in the path.
 */
export type ToolParam = { type: "string" | "number"; description: string; required?: boolean };
export type PluginContext = { token: string; fetch: typeof fetch };
export type PluginTool = {
  slug: string;
  description: string;
  /** Read-only tools run after a normal approval; anything that changes data is flagged so the UI can say so. */
  readOnly: boolean;
  parameters: Record<string, ToolParam>;
  run(args: Record<string, unknown>, ctx: PluginContext): Promise<unknown>;
};
export type PluginDefinition = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  glyph: string;
  /** Google API scopes this plugin needs. The account email scope is added by the engine. */
  scopes: string[];
  tools: PluginTool[];
};

export const GOOGLE_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const MAX_TEXT = 12_000;

const str = (value: unknown, name: string, max = 2000): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${name}" is required.`);
  return value.trim().slice(0, max);
};
const optStr = (value: unknown, max = 2000): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const count = (value: unknown, fallback: number, max: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};
const isoDate = (value: unknown, name: string): string => {
  const text = str(value, name, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`"${name}" must be an ISO date-time such as 2026-11-20T15:00:00+02:00.`);
  return new Date(text).toISOString();
};

export class GoogleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = "GoogleApiError"; this.status = status; }
}

async function api(ctx: PluginContext, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await ctx.fetch(url, { ...init, headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json() as { error?: { message?: string } | string }; detail = typeof body.error === "string" ? body.error : body.error?.message ?? ""; } catch { /* no JSON body */ }
    throw new GoogleApiError(response.status, detail || `Google returned HTTP ${response.status}.`);
  }
  return response;
}
const json = async (ctx: PluginContext, url: string, init?: RequestInit): Promise<any> => (await api(ctx, url, init)).json();

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** RFC 2047 encoding for a header value that contains non-ASCII characters. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}
export function buildRawEmail(to: string, subject: string, body: string): string {
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error("Recipient and subject must be single lines.");
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) throw new Error('"to" must be one email address.');
  return encodeBase64Url(["To: " + to, "Subject: " + encodeHeader(subject), "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", body].join("\r\n"));
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
function findBody(part: GmailPart | undefined, mime: string): string {
  if (!part) return "";
  if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) { const text = findBody(child, mime); if (text) return text; }
  return "";
}
/** Prefers a text/plain part anywhere in the message; only falls back to stripped HTML when there is none. */
export function extractPlainText(part: GmailPart | undefined): string {
  const plain = findBody(part, "text/plain");
  if (plain) return plain;
  return findBody(part, "text/html").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
const header = (headers: Array<{ name: string; value: string }> | undefined, name: string): string =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const gmail: PluginDefinition = {
  id: "gmail", name: "Gmail", accent: "#ea4335", glyph: "M",
  tagline: "Search, read and send email",
  description: "Lets ULTRON search your inbox, read a message and, only when you approve each one, send email from your own account.",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  tools: [
    {
      slug: "GMAIL_SEARCH_MESSAGES", readOnly: true,
      description: "Search the inbox with Gmail search syntax (for example: from:alice newer_than:7d). Returns sender, subject, date and a snippet.",
      parameters: { query: { type: "string", description: "Gmail search query", required: true }, max_results: { type: "number", description: "1 to 15, default 8" } },
      async run(args, ctx) {
        const query = str(args.query, "query", 500);
        const list = await json(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${count(args.max_results, 8, 15)}`);
        const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
        const rows = await Promise.all(ids.map(async (id) => {
          const m = await json(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          return { id, from: header(m.payload?.headers, "From"), subject: header(m.payload?.headers, "Subject"), date: header(m.payload?.headers, "Date"), snippet: m.snippet ?? "" };
        }));
        return { count: rows.length, messages: rows };
      },
    },
    {
      slug: "GMAIL_READ_MESSAGE", readOnly: true,
      description: "Read one email by id (from a search result): headers and plain-text body.",
      parameters: { message_id: { type: "string", description: "Message id", required: true } },
      async run(args, ctx) {
        const id = str(args.message_id, "message_id", 64);
        if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('"message_id" is not valid.');
        const m = await json(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
        const body = extractPlainText(m.payload);
        return { id, from: header(m.payload?.headers, "From"), to: header(m.payload?.headers, "To"), subject: header(m.payload?.headers, "Subject"), date: header(m.payload?.headers, "Date"), body: body.slice(0, MAX_TEXT), truncated: body.length > MAX_TEXT };
      },
    },
    {
      slug: "GMAIL_SEND_EMAIL", readOnly: false,
      description: "Send a plain-text email from the connected account. This sends real mail; it is only run after the user approves it.",
      parameters: { to: { type: "string", description: "One recipient email address", required: true }, subject: { type: "string", description: "Subject line", required: true }, body: { type: "string", description: "Plain-text body", required: true } },
      async run(args, ctx) {
        const raw = buildRawEmail(str(args.to, "to", 320), str(args.subject, "subject", 300), str(args.body, "body", 20_000));
        const sent = await json(ctx, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
        return { sent: true, id: sent.id, thread_id: sent.threadId };
      },
    },
  ],
};

const calendar: PluginDefinition = {
  id: "google_calendar", name: "Google Calendar", accent: "#4285f4", glyph: "31",
  tagline: "See and create events",
  description: "Lets ULTRON read your upcoming events and, when you approve, add new events to your primary calendar.",
  scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  tools: [
    {
      slug: "CALENDAR_LIST_EVENTS", readOnly: true,
      description: "List events on the primary calendar between two times (defaults to the next 7 days).",
      parameters: { time_min: { type: "string", description: "ISO date-time, default now" }, time_max: { type: "string", description: "ISO date-time, default now + 7 days" }, max_results: { type: "number", description: "1 to 50, default 20" } },
      async run(args, ctx) {
        const min = args.time_min ? isoDate(args.time_min, "time_min") : new Date().toISOString();
        const max = args.time_max ? isoDate(args.time_max, "time_max") : new Date(Date.parse(min) + 7 * 86_400_000).toISOString();
        const data = await json(ctx, `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&maxResults=${count(args.max_results, 20, 50)}`);
        return { events: (data.items ?? []).map((e: any) => ({ id: e.id, summary: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location ?? "", link: e.htmlLink })) };
      },
    },
    {
      slug: "CALENDAR_CREATE_EVENT", readOnly: false,
      description: "Create an event on the primary calendar. Changes the user's calendar; only run after approval.",
      parameters: { summary: { type: "string", description: "Event title", required: true }, start: { type: "string", description: "ISO date-time with offset", required: true }, end: { type: "string", description: "ISO date-time with offset", required: true }, description: { type: "string", description: "Optional notes" }, location: { type: "string", description: "Optional location" } },
      async run(args, ctx) {
        const start = isoDate(args.start, "start"), end = isoDate(args.end, "end");
        if (Date.parse(end) <= Date.parse(start)) throw new Error('"end" must be after "start".');
        const event = await json(ctx, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: str(args.summary, "summary", 300), description: optStr(args.description, 4000), location: optStr(args.location, 300), start: { dateTime: start }, end: { dateTime: end } }),
        });
        return { created: true, id: event.id, link: event.htmlLink };
      },
    },
  ],
};

const drive: PluginDefinition = {
  id: "google_drive", name: "Google Drive", accent: "#0f9d58", glyph: "▲",
  tagline: "Find and read your files",
  description: "Lets ULTRON search your Drive and read the text of Docs, Sheets, Slides and text files. Read-only; it cannot change or delete anything.",
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  tools: [
    {
      slug: "DRIVE_SEARCH_FILES", readOnly: true,
      description: "Search Drive by words in the name or content. Returns id, name, type, modified time and link.",
      parameters: { query: { type: "string", description: "Words to search for", required: true }, max_results: { type: "number", description: "1 to 20, default 10" } },
      async run(args, ctx) {
        const words = str(args.query, "query", 200).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const q = encodeURIComponent(`fullText contains '${words}' and trashed = false`);
        const data = await json(ctx, `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${count(args.max_results, 10, 20)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`);
        return { files: data.files ?? [] };
      },
    },
    {
      slug: "DRIVE_READ_FILE", readOnly: true,
      description: "Read the text of one Drive file by id: Docs and Slides as text, Sheets as CSV, plain-text files as-is.",
      parameters: { file_id: { type: "string", description: "Drive file id", required: true } },
      async run(args, ctx) {
        const id = str(args.file_id, "file_id", 128);
        if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('"file_id" is not valid.');
        const meta = await json(ctx, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size`);
        const type: string = meta.mimeType ?? "";
        let url: string;
        if (type === "application/vnd.google-apps.spreadsheet") url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`;
        else if (type.startsWith("application/vnd.google-apps.")) url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`;
        else if (type.startsWith("text/") || type === "application/json") url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
        else throw new Error(`ULTRON can only read text-based files; this one is ${type || "an unknown type"}.`);
        const text = await (await api(ctx, url, { headers: { Accept: "text/plain, text/csv, application/json" } })).text();
        return { id, name: meta.name, mime_type: type, content: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
      },
    },
  ],
};

export const PLUGIN_CATALOG: readonly PluginDefinition[] = [gmail, calendar, drive];
export const pluginById = (id: string): PluginDefinition | undefined => PLUGIN_CATALOG.find((p) => p.id === id);
