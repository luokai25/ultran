import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const runtime = read("supabase/functions/ultron-runtime/index.ts");
const jobs = read("supabase/functions/ultron-jobs/index.ts");
const app = read("apps/phone/src/main.ts");

assert.ok(runtime.includes('"artifact.create"'));
assert.ok(runtime.includes('id:"artifact.create"'));
assert.ok(runtime.includes('if (op === "artifact.create")'));
assert.ok(runtime.includes('!internalWorker || !sourceJobId'));
assert.ok(runtime.includes('serviceDb.storage.from("ultron-private")'));
assert.ok(runtime.includes('serviceDb.from("ultron_artifacts").insert'));
assert.ok(runtime.includes('source_job_id: sourceJobId'));
assert.ok(runtime.includes('ultron-artifact://'));
assert.ok(jobs.includes('source_job_id: job.id'));
assert.ok(app.includes('artifact.create as a workflow step'));

console.log("ULTRON durable workflow artifact creation contracts passed.");
