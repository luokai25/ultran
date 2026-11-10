import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
const brain = readFileSync(new URL("../functions/ultron-brain/index.ts", import.meta.url), "utf8");
const chatStart = brain.indexOf("async function handleChat(");
const chat = brain.slice(chatStart, brain.indexOf("async function captureCapabilitySnapshot(", chatStart));

test("public and cron-driven functions pin verify_jwt = false in tracked config", () => {
  // The client sends a publishable key and pg_cron sends only x-ultron-cron-secret; neither is a JWT.
  for (const name of ["ultron-brain", "ultron-runtime", "ultron-capabilities", "ultron-jobs"]) {
    const block = config.match(new RegExp(`\\[functions\\.${name}\\]([^\\[]*)`));
    assert.ok(block, `${name} must be declared in supabase/config.toml`);
    assert.match(block[1], /verify_jwt\s*=\s*false/, `${name} must disable gateway JWT verification`);
  }
});

test("cloud chat falls back past hung, errored and empty provider streams", () => {
  assert.match(brain, /from "\.\/stream-preflight\.ts"/);
  assert.match(chat, /preflightStream\(upstream, config\.protocol/, "a 200 response must be preflighted before it is returned to the browser");
  assert.match(chat, /CHAT_HEADER_TIMEOUT_MS/, "each provider attempt needs its own header timeout");
  assert.doesNotMatch(chat, /MAX_CHAT_ATTEMPTS/, "the full key pool stays eligible; latency is bounded by time, not attempt count");
  assert.match(chat, /CHAT_SELECTION_BUDGET_MS/, "provider selection must finish inside the browser's 120 s idle timeout");
});

test("a model- or request-level provider error never marks a whole key unreachable", () => {
  assert.doesNotMatch(chat, /keyStateForStatus\(upstream\.status\)/, "chat failures go through markChatFailure");
  const helper = brain.slice(brain.indexOf("async function markChatFailure("), chatStart);
  const statusAssignments = [...helper.matchAll(/status: "([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(statusAssignments.sort(), ["expired", "invalid", "rate_limited"], "only credential and quota failures change key status");
});

test("trimming a long conversation keeps the leading system prompt", () => {
  assert.doesNotMatch(chat, /\.slice\(-80\) : \[\];/, "plain slice(-80) drops ULTRON's system prompt after message 80");
  assert.match(chat, /leadingSystem/);
});
