import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("Offer Builder preserves its supplied HTML and routes generation through ULTRON", async () => {
  const [asset, host, backend, main, cloudLlm, brain, productStudio, jobs] = await Promise.all([
    read("apps/phone/src/offer-builder-asset.ts"),
    read("apps/phone/src/product-studio.ts"),
    read("supabase/functions/ultron-offer-builder/index.ts"),
    read("apps/phone/src/main.ts"),
    read("apps/phone/src/cloud-llm.ts"),
    read("supabase/functions/ultron-brain/index.ts"),
    read("supabase/functions/ultron-product-studio/index.ts"),
    read("supabase/functions/ultron-jobs/index.ts"),
  ]);
  const match = asset.match(/OFFER_BUILDER_HTML_GZIP_BASE64 = "([A-Za-z0-9+/=]+)"/);
  assert.ok(match, "compressed Offer Builder asset exists");
  const html = gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
  assert.match(html, /What do you know, care about, or want to help people with/);
  assert.match(html, /Visceral Transformation Map/);
  assert.match(html, /Your eBook Structure/);
  assert.match(html, /ULTRON_OFFER_ACTION/);
  assert.match(html, /stage:'discovery'/);
  assert.match(html, /stage:'outline'/);
  assert.match(html, /stage:'transformation'/);
  assert.match(html, /stage:'section'/);
  assert.match(html, /ultronApi\('finalize'/);
  assert.match(host, /OFFER_BUILDER_HTML_GZIP_BASE64/);
  assert.match(host, /functions\.invoke\("ultron-offer-builder"/);
  assert.match(host, /event\.source !== frame\.contentWindow/);
  assert.match(host, /event\.origin !== "null"/);
  assert.ok(host.includes("html.replace(offerActionMessage, \"parent.postMessage({type:'ULTRON_OFFER_ACTION',id,action,payload:payload||{}},'*');\")"));
  assert.ok(host.includes('}, "*");'));
  assert.match(host, /stage:'summary'/);
  assert.match(host, /stage:'quality'/);
  assert.ok(host.includes("s.html=b.innerHTML;s.markdown=content;S.words+="));
  assert.match(host, /Resuming saved manuscript sections/);
  assert.match(host, /const markdownMatch =/);
  assert.match(host, /const alreadyEnriched =/);
  assert.match(host, /Framework Glossary/);
  assert.match(main, /async function submitTurn\(raw: string\)/);
  assert.match(main, /async function submit\(raw: string\)/);
  assert.match(main, /ULTRON hit an internal chat error/);
  assert.doesNotMatch(cloudLlm, /setTimeout\(\(\) => controller\.abort\(\), 90_000\)/);
  assert.match(cloudLlm, /signal\.addEventListener\("abort", abortFromCaller/);
  assert.match(cloudLlm, /invalid event from the cloud response stream/);
  assert.match(brain, /select\("id,owner_id,label,vault_secret_id,key_fingerprint,status,enabled,priority,models,request_count,tokens_used,cooldown_until,last_used_at,last_checked_at,last_error,created_at"\)/);
  assert.match(brain, /reserve capacity for cross-provider/);
  assert.doesNotMatch(brain, /select\("\*"\)/);
  const extractInjectedCode = (name) => {
    const marker = "const " + name + " = [";
    const start = host.indexOf(marker);
    assert.notEqual(start, -1, name + " patch exists");
    const end = host.indexOf("].join(", start);
    assert.notEqual(end, -1, name + " patch closes");
    return host.slice(start + marker.length, end).split(String.fromCharCode(10))
      .map((line) => line.trim().replace(/,$/, ""))
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .join(String.fromCharCode(10));
  };
  const summaryCode = extractInjectedCode("summaryStep");
  const manuscriptCode = extractInjectedCode("manuscriptStep");
  assert.doesNotThrow(() => new Function(summaryCode), "summary step syntax");
  assert.doesNotThrow(() => new Function(manuscriptCode), "manuscript step syntax");
  assert.match(backend, /functions\/v1\/ultron-brain/);
  assert.match(backend, /action: internalWorker \? "worker_chat" : "chat"/);
  assert.match(backend, /offer_builder\.generate/);
  assert.match(backend, /ultron_offer_builder_runs/);
  assert.match(backend, /worker_process/);
  assert.match(backend, /researchCreator/);
  assert.match(backend, /creator\.public_research_completed/);
  assert.match(host, /waitForOfferBuilderRun/);
  assert.match(host, /restoreOfferBuilderState/);
  assert.match(host, /2147483647/);
  assert.match(brain, /body\.action === "worker_chat"/);
  assert.doesNotMatch(brain, /candidates\.slice\(0, 8\)/);
  assert.doesNotMatch(productStudio, /free_google_search_daily_cap_reached/);
  assert.doesNotMatch(productStudio, /candidates\.slice\(0, withSearch/);
  assert.doesNotMatch(productStudio, /\.limit\(30\)/);
  assert.match(jobs, /job\.job_type === "offer_builder\.generate"/);
  assert.match(jobs, /ultron_offer_builder_runs/);
  assert.match(backend, /ultron_product_documents/);
});
