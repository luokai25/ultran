import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("Offer Builder preserves its supplied HTML and routes generation through ULTRON", async () => {
  const [asset, host, backend] = await Promise.all([
    read("apps/phone/src/offer-builder-asset.ts"),
    read("apps/phone/src/product-studio.ts"),
    read("supabase/functions/ultron-offer-builder/index.ts"),
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
  assert.match(host, /stage:'summary'/);
  assert.match(host, /stage:'quality'/);
  assert.match(host, /s\\.markdown=content/);
  assert.match(host, /Resuming saved manuscript sections/);
  assert.match(backend, /functions\/v1\/ultron-brain/);
  assert.match(backend, /action: "chat"/);
  assert.match(backend, /offer_builder/);
  assert.match(backend, /ultron_product_documents/);
});
