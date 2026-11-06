import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const brain = read("supabase/functions/ultron-brain/index.ts");
const jobs = read("supabase/functions/ultron-jobs/index.ts");
const runtime = read("supabase/functions/ultron-runtime/index.ts");
const connectors = read("supabase/functions/ultron-connectors/index.ts");
const capabilities = read("supabase/functions/ultron-capabilities/index.ts");
const keysMigration = read("supabase/migrations/20261105150412_ultron_cloud_llm_key_pool.sql");
const recoveryMigration = read("supabase/migrations/20261105151402_ultron_capability_crash_recovery.sql");
const systemDdlMigration = read("supabase/migrations/20261105153016_ultron_system_schema_authoring.sql");
const phone = read("apps/phone/src/cloud-llm.ts");
const main = read("apps/phone/src/main.ts");

for (const provider of ["openrouter", "mistral", "cerebras", "groq", "cohere"]) {
  assert.ok(keysMigration.includes(`'${provider}'`), `missing ${provider} key pool table`);
  assert.ok(brain.includes(`${provider}: { label:`), `gateway is missing ${provider} provider configuration`);
}
assert.match(keysMigration, /vault\.create_secret/);
assert.match(keysMigration, /vault\.decrypted_secrets/);
assert.match(keysMigration, /revoke insert, update, delete, truncate, references, trigger on public\.%I from anon, authenticated/);
assert.match(brain, /function isFreeModel/);
assert.match(brain, /id\.endsWith\(":free"\)/);
assert.match(brain, /rate_limited/);
assert.match(brain, /ultron_store_llm_secret/);
assert.match(brain, /ultron_read_llm_secret/);
assert.match(brain, /ultron_delete_llm_secret/);
assert.match(brain, /free_provider_registry/);
assert.match(brain, /brain_failure_history/);
assert.match(brain, /known_failed_change/);
assert.match(brain, /Do not repeat an exact failed change fingerprint/);
assert.match(brain, /ultron-jobs/);
assert.match(jobs, /generateMemoryProposal/);
assert.doesNotMatch(jobs, /ULTRON_MODEL_API_KEY/);
assert.match(jobs, /ultron_claim_jobs_system/);
assert.match(runtime, /requireOperationPermission/);
assert.match(runtime, /approval_required/);
assert.match(runtime, /ultron_apply_schema_change_system/);
assert.match(runtime, /x-ultron-cron-secret/);
assert.match(systemDdlMigration, /p_owner_id uuid/);
assert.match(systemDdlMigration, /service_role/);
assert.match(connectors, /x-ultron-cron-secret/);
assert.match(capabilities, /checkpoint_before_change/);
assert.match(capabilities, /mark_change_crashed/);
assert.match(recoveryMigration, /ultron_restore_generated_tool_lifecycle/);
assert.match(recoveryMigration, /ultron\.recovery_mode/);
assert.match(phone, /streamUltronSupabaseChat/);
assert.match(phone, /functions\.invoke\("ultron-brain"/);
assert.match(main, /addModelChoice\("Ultron Supabase"/);
assert.match(main, /cloudBrainActive/);
assert.match(main, /cloudConnectedKeys < 1/);

assert.ok(brain.includes('provider === "cerebras") return false'));
assert.ok(jobs.includes('provider === "cerebras") return false'));
assert.ok(main.includes("one-time $5 trial"));

console.log("ULTRON cloud LLM, Vault, worker, permission and crash-recovery contracts passed.");
