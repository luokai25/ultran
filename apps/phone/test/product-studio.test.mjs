import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(repo, relative), "utf8");

test("Product Studio is registered in the canonical shared web and Android client", async () => {
  const [html, main, moduleSource, css, ledger, design] = await Promise.all([
    read("apps/phone/index.html"),
    read("apps/phone/src/main.ts"),
    read("apps/phone/src/product-studio.ts"),
    read("apps/phone/src/product-studio.css"),
    read("docs/ULTRON-SCREEN-COVERAGE.md"),
    read("DESIGN.md"),
  ]);
  assert.match(html, /id="drawer-product-studio"/);
  assert.match(html, /id="product-studio-screen"/);
  assert.match(html, /id="product-studio-preview"[^>]*sandbox=""/);
  assert.match(main, /initProductStudio\(/);
  assert.match(main, /openProductStudioScreen/);
  assert.match(moduleSource, /functions\.invoke\("ultron-product-studio"/);
  assert.match(moduleSource, /product-studio-refresh-list/);
  assert.match(moduleSource, /product-studio-resume/);
  assert.match(moduleSource, /setInterval\(/);
  assert.match(css, /@media\(min-width:900px\)/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.ok(ledger.includes("product-studio-screen"), "screen coverage ledger must list Product Studio");
  assert.ok(design.includes("#product-studio-screen"), "design inventory must list Product Studio");
});

test("Product Studio routes free inference across existing Vault-backed providers", async () => {
  const source = await read("supabase/functions/ultron-product-studio/index.ts");
  assert.match(source, /ultron_read_llm_secret/);
  assert.match(source, /providerTable\(provider\)/);
  assert.match(source, /"openrouter", "groq", "google_ai_studio"/);
  assert.match(source, /isFreeProviderModel/);
  assert.match(source, /callStudioStreaming/);\n  assert.match(source, /opportunity_score/);\n  assert.match(source, /validation/);
  assert.match(source, /canonicalReferences/);
  assert.match(source, /product-v" \+ version/);
  assert.match(source, /version, source_counts/);
  assert.match(source, /runWithProviderWait/);
  assert.match(source, /provider\.waiting/);
  assert.match(source, /waiting_for_provider/);
  assert.match(source, /no_free_google_search_model_available/);
  assert.match(source, /google_search/);
  assert.match(source, /cooldown_until/);
  assert.match(source, /request_count/);
  assert.match(source, /tokens_used/);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
});

test("Product Studio research obeys public crawl limits and streams safe previews", async () => {
  const source = await read("supabase/functions/ultron-product-studio/index.ts");
  assert.match(source, /robots\.txt/);
  assert.match(source, /robotsPathMatches/);
  assert.match(source, /isPublicResearchUrl/);
  assert.match(source, /readPublicTextLimited/);
  assert.match(source, /projectStopStatus/);
  assert.match(source, /product_project_stopped/);
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /draft\.block\.updated/);
  assert.match(source, /sandbox/);
  assert.match(source, /ultron-private/);
  assert.match(source, /content_storage_path/);
  assert.match(source, /research_round/);
  assert.match(source, /stalled_rounds/);
  assert.match(source, /next_batch_queued/);
  assert.match(source, /references_section/);
});

test("Product Studio worker requires a claimed lease and private owner-scoped tables", async () => {
  const [jobs, worker, migration, backgroundWorker] = await Promise.all([
    read("supabase/functions/ultron-jobs/index.ts"),
    read("supabase/functions/ultron-product-studio/index.ts"),
    read("supabase/migrations/20261109000100_ultron_ai_digital_product_studio.sql"),\n    read("supabase/migrations/20261109000300_ultron_product_studio_background_worker.sql"),
  ]);
  assert.match(jobs, /job\.job_type === "product\.generate"/);
  assert.match(jobs, /research_round: payload\.research_round/);
  assert.match(jobs, /lock_token: job\.lock_token/);
  assert.match(jobs, /waitingForProvider \? 180/);
  assert.match(worker, /valid_claimed_product_job_required/);
  assert.match(worker, /x-ultron-cron-secret/);
  assert.match(worker, /createSignedUrl/);
  assert.match(worker, /"resume"/);
  assert.match(worker, /"partial","failed","paused","waiting_for_provider"/);
  assert.match(worker, /"cancel"/);
  for (const table of ["ultron_product_projects", "ultron_product_sources", "ultron_product_events", "ultron_product_documents"]) {
    assert.ok(migration.includes("create table if not exists public." + table), "missing table " + table);
    assert.ok(migration.includes("alter table public." + table + " enable row level security"), "RLS not enabled for " + table);
  }
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.ultron_product_events/);
});
