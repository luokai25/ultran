import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("durable cloud jobs expose a complete lease and retry lifecycle", async () => {
  const api = await readFile(new URL("../src/runtime-jobs.ts", import.meta.url), "utf8");
  for (const action of ["enqueue", "list", "claim", "heartbeat", "complete", "fail", "cancel"]) {
    assert.ok(api.includes('invokeUltronJobs("' + action + '"'));
  }
  assert.match(api, /lock_token/);
  assert.match(api, /claimUltronJobs/);
  assert.match(api, /failUltronJob/);
});

test("cloud workspace subscribes to durable job updates", async () => {
  const sync = await readFile(new URL("../src/cloud-sync.ts", import.meta.url), "utf8");
  assert.match(sync, /table: 'ultron_jobs'/);
});

test("agent can retrieve durable Supabase job results after queueing tools", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /runtime\.cloud\.jobs/);
  assert.match(main, /runtime\.cloud\.status/);
  assert.match(main, /listUltronJobs/);
  assert.match(main, /never report success while its status is queued or running/);
});
