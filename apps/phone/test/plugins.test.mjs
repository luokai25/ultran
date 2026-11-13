import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const toUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const transpile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

const catalogUrl = toUrl(transpile(src("plugins/catalog.ts")));
const capacitorStub = toUrl('export const Capacitor = { getPlatform: () => "android" }; export const registerPlugin = () => ({ authorize: async () => { throw new Error("native"); } });');
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };
const catalog = await import(catalogUrl);
const engineMod = await import(toUrl(transpile(src("plugins/engine.ts")).replace('"@capacitor/core"', JSON.stringify(capacitorStub)).replace('"./catalog"', JSON.stringify(catalogUrl))));
const { createPluginEngine, PluginError } = engineMod;
const { PLUGIN_CATALOG, buildRawEmail, encodeBase64Url, decodeBase64Url, extractPlainText, GOOGLE_EMAIL_SCOPE } = catalog;

function makeEngine({ platform = "android", authorize, fetchImpl } = {}) {
  const store = new Map();
  const calls = { authorize: [], fetch: [] };
  const engine = createPluginEngine({
    auth: { authorize: async (options) => { calls.authorize.push(options); return authorize ? authorize(options) : { accessToken: "tok-" + calls.authorize.length, grantedScopes: options.scopes }; } },
    fetchImpl: async (url, init) => { calls.fetch.push({ url: String(url), init }); return fetchImpl ? fetchImpl(String(url), init) : new Response(JSON.stringify({ email: "owner@example.com" }), { status: 200 }); },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    platform: () => platform,
    now: () => 1_000_000,
  });
  return { engine, calls, store };
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

test("the catalogue ships Gmail, Calendar and Drive with unique tool slugs and honest read/write flags", () => {
  assert.deepEqual(PLUGIN_CATALOG.map((p) => p.id), ["gmail", "google_calendar", "google_drive"]);
  const slugs = PLUGIN_CATALOG.flatMap((p) => p.tools.map((t) => t.slug));
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[A-Z][A-Z0-9_]{2,119}$/);
  const writes = PLUGIN_CATALOG.flatMap((p) => p.tools).filter((t) => !t.readOnly).map((t) => t.slug).sort();
  assert.deepEqual(writes, ["CALENDAR_CREATE_EVENT", "GMAIL_SEND_EMAIL"]);
  assert.deepEqual(PLUGIN_CATALOG.find((p) => p.id === "google_drive").scopes, ["https://www.googleapis.com/auth/drive.readonly"]);
});

test("email building rejects header injection and bad recipients and encodes non-ASCII subjects", () => {
  assert.throws(() => buildRawEmail("a@b.co", "hi\r\nBcc: evil@x.co", "x"), /single lines/);
  assert.throws(() => buildRawEmail("a@b.co\r\nBcc: x@y.co", "s", "x"), /single lines/);
  assert.throws(() => buildRawEmail("not-an-address", "s", "x"), /one email address/);
  assert.throws(() => buildRawEmail("a@b.co, c@d.co", "s", "x"), /one email address/);
  const raw = decodeBase64Url(buildRawEmail("a@b.co", "Grüße", "Héllo"));
  assert.match(raw, /^To: a@b\.co\r\nSubject: =\?UTF-8\?B\?/);
  assert.ok(raw.endsWith("\r\n\r\nHéllo"));
});

test("base64url round-trips unicode and Gmail bodies prefer text/plain over HTML", () => {
  assert.equal(decodeBase64Url(encodeBase64Url("héllo wörld ✓")), "héllo wörld ✓");
  const part = { mimeType: "multipart/alternative", parts: [
    { mimeType: "text/html", body: { data: encodeBase64Url("<p>HTML <b>body</b></p>") } },
    { mimeType: "text/plain", body: { data: encodeBase64Url("Plain body") } } ] };
  assert.equal(extractPlainText(part), "Plain body");
  assert.equal(extractPlainText({ mimeType: "text/html", body: { data: encodeBase64Url("<style>x{}</style><p>Only <b>html</b></p>") } }), "Only html");
});

test("connecting a plugin asks Google once for exactly that plugin's scopes and remembers the account", async () => {
  const { engine, calls } = makeEngine();
  const entry = await engine.install("gmail");
  assert.deepEqual(calls.authorize[0].scopes, [GOOGLE_EMAIL_SCOPE, "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]);
  assert.equal(entry.account, "owner@example.com");
  assert.equal(engine.isInstalled("gmail"), true);
  assert.equal(engine.isInstalled("google_drive"), false);
  assert.equal(calls.fetch[0].init.headers.Authorization, "Bearer tok-1");
});

test("a partial consent grant is refused and nothing is stored", async () => {
  const { engine } = makeEngine({ authorize: async () => ({ accessToken: "t", grantedScopes: [GOOGLE_EMAIL_SCOPE, "https://www.googleapis.com/auth/gmail.readonly"] }) });
  await assert.rejects(() => engine.install("gmail"), (e) => e instanceof PluginError && e.code === "partial");
  assert.equal(engine.installed().length, 0);
});

test("native errors keep their code, and a non-Android platform cannot connect", async () => {
  const cancelled = makeEngine({ authorize: async () => { throw Object.assign(new Error("Google authorization was cancelled."), { code: "cancelled" }); } });
  await assert.rejects(() => cancelled.engine.install("google_drive"), (e) => e.code === "cancelled");
  const developer = makeEngine({ authorize: async () => { throw Object.assign(new Error("Google does not recognise this build"), { code: "developer_error" }); } });
  await assert.rejects(() => developer.engine.install("google_drive"), (e) => e.code === "developer_error" && /recognise/.test(e.message));
  const web = makeEngine({ platform: "web" });
  await assert.rejects(() => web.engine.install("gmail"), (e) => e.code === "unavailable");
});

test("tools are listed only for connected plugins and running one requires the plugin to be connected", async () => {
  const { engine } = makeEngine();
  assert.deepEqual(engine.tools(), []);
  await assert.rejects(() => engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "x" }), (e) => e.code === "not_installed");
  await engine.install("google_calendar");
  const tools = engine.tools();
  assert.deepEqual(tools.map((t) => t.tool_slug).sort(), ["CALENDAR_CREATE_EVENT", "CALENDAR_LIST_EVENTS"]);
  assert.equal(tools.find((t) => t.tool_slug === "CALENDAR_CREATE_EVENT").read_only, false);
  await assert.rejects(() => engine.run("google_calendar", "NOPE_TOOL", {}), (e) => e.code === "unknown_tool");
  await assert.rejects(() => engine.run("not_a_plugin", "X_Y_Z", {}), (e) => e.code === "unknown_plugin");
});

test("running a Gmail search calls Google directly with the bearer token and reuses the cached token", async () => {
  const { engine, calls } = makeEngine({ fetchImpl: (url) => {
    if (url.includes("userinfo")) return ok({ email: "owner@example.com" });
    if (url.includes("/messages?q=")) return ok({ messages: [{ id: "m1" }] });
    if (url.includes("/messages/m1")) return ok({ snippet: "Hi there", payload: { headers: [{ name: "From", value: "A <a@x.co>" }, { name: "Subject", value: "Plans" }, { name: "Date", value: "Mon" }] } });
    return new Response("{}", { status: 404 });
  } });
  await engine.install("gmail");
  const result = await engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "from:a newer_than:2d", max_results: 3 });
  assert.deepEqual(result, { count: 1, messages: [{ id: "m1", from: "A <a@x.co>", subject: "Plans", date: "Mon", snippet: "Hi there" }] });
  const search = calls.fetch.find((c) => c.url.includes("/messages?q="));
  assert.match(search.url, /q=from%3Aa%20newer_than%3A2d&maxResults=3/);
  assert.equal(search.init.headers.Authorization, "Bearer tok-1");
  await engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "again" });
  assert.equal(calls.authorize.length, 1, "the access token is reused instead of asking Google again");
});

test("Google API failures become actionable messages and a 401 drops the cached token", async () => {
  let status = 403;
  const { engine, calls } = makeEngine({ fetchImpl: (url) => url.includes("userinfo") ? ok({ email: "o@x.co" }) : new Response(JSON.stringify({ error: { message: "Gmail API has not been used in project 1 before or it is disabled." } }), { status }) });
  await engine.install("gmail");
  await assert.rejects(() => engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "x" }), (e) => e.code === "forbidden" && /not been used in project/.test(e.message) && /enable it in the Google Cloud project/.test(e.message));
  status = 401;
  await assert.rejects(() => engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "x" }), (e) => e.code === "reauth");
  await assert.rejects(() => engine.run("gmail", "GMAIL_SEARCH_MESSAGES", { query: "x" }), () => true);
  assert.ok(calls.authorize.length >= 2, "after a 401 a fresh token is requested");
});

test("sending email builds a real Gmail send request and validates input before any network call", async () => {
  const { engine, calls } = makeEngine({ fetchImpl: (url) => url.includes("userinfo") ? ok({ email: "o@x.co" }) : ok({ id: "sent1", threadId: "t1" }) });
  await engine.install("gmail");
  const before = calls.fetch.length;
  await assert.rejects(() => engine.run("gmail", "GMAIL_SEND_EMAIL", { to: "bad", subject: "s", body: "b" }), /one email address/);
  assert.equal(calls.fetch.length, before);
  const result = await engine.run("gmail", "GMAIL_SEND_EMAIL", { to: "friend@example.com", subject: "Hello", body: "Hi" });
  assert.deepEqual(result, { sent: true, id: "sent1", thread_id: "t1" });
  const send = calls.fetch.at(-1);
  assert.equal(send.init.method, "POST");
  assert.match(decodeBase64Url(JSON.parse(send.init.body).raw), /^To: friend@example\.com\r\nSubject: Hello/);
});

test("calendar creation rejects an end before the start; Drive refuses binary files", async () => {
  const { engine } = makeEngine({ fetchImpl: (url) => url.includes("userinfo") ? ok({ email: "o@x.co" }) : ok({ id: "f1", name: "pic.png", mimeType: "image/png" }) });
  await engine.install("google_calendar");
  await engine.install("google_drive");
  await assert.rejects(() => engine.run("google_calendar", "CALENDAR_CREATE_EVENT", { summary: "x", start: "2026-11-20T15:00:00Z", end: "2026-11-20T14:00:00Z" }), /after "start"/);
  await assert.rejects(() => engine.run("google_drive", "DRIVE_READ_FILE", { file_id: "f1" }), /only read text-based files/);
  await assert.rejects(() => engine.run("google_drive", "DRIVE_READ_FILE", { file_id: "bad id!" }), /not valid/);
});

test("removing the last plugin revokes Google access; removing one of several does not", async () => {
  const { engine, calls } = makeEngine();
  await engine.install("gmail");
  await engine.install("google_drive");
  const first = await engine.remove("gmail");
  assert.equal(first.revoked, false);
  assert.ok(!calls.fetch.some((c) => c.url.includes("oauth2.googleapis.com/revoke")));
  const last = await engine.remove("google_drive");
  assert.equal(last.revoked, true);
  const revoke = calls.fetch.find((c) => c.url.includes("oauth2.googleapis.com/revoke"));
  assert.equal(revoke.init.method, "POST");
  assert.match(revoke.init.body, /^token=tok-/);
  assert.equal(engine.installed().length, 0);
});

test("native plugin, Gradle dependency and scope rules stay in step", () => {
  const java = readFileSync(new URL("../android/app/src/main/java/app/ultron/mobile/UltronGoogleAuthPlugin.java", import.meta.url), "utf8");
  const main = readFileSync(new URL("../android/app/src/main/java/app/ultron/mobile/MainActivity.java", import.meta.url), "utf8");
  const gradle = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
  assert.match(main, /registerPlugin\(UltronGoogleAuthPlugin\.class\)/);
  assert.match(gradle, /com\.google\.android\.gms:play-services-auth:/);
  assert.match(java, /requestCodes = \{ UltronGoogleAuthPlugin\.REQUEST_AUTHORIZE \}/);
  assert.match(java, /startsWith\("https:\/\/www\.googleapis\.com\/auth\/"\)/);
  assert.doesNotMatch(java, /SharedPreferences|putString|getSharedPreferences/, "tokens are never persisted natively");
  for (const plugin of PLUGIN_CATALOG) {
    const scopes = [GOOGLE_EMAIL_SCOPE, ...plugin.scopes];
    assert.ok(scopes.length <= 12);
    for (const scope of scopes) assert.ok(scope.startsWith("https://www.googleapis.com/auth/"), `${plugin.id}: ${scope}`);
  }
});

test("the Plugins screen is local-only: no Supabase, Composio, MCP gateway or server calls", () => {
  const files = ["plugins/catalog.ts", "plugins/engine.ts", "plugins-ui.ts"].map(src).join("\n");
  assert.doesNotMatch(files, /supabase|composio|vercel|ultron-connectors|cloudClient/i);
  const html = src("../index.html");
  assert.match(html, /id="connectors-list" class="plug-grid"/);
  assert.doesNotMatch(html, /composio-api-key|mcp-server-url/);
  assert.match(src("main.ts"), /initPlugins\(\)/);
});
