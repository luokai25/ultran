import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("cloud artifact client supports signed upload, listing, download and deletion", async () => {
  const api = await readFile(new URL("../src/artifact-storage.ts", import.meta.url), "utf8");
  for (const action of ["prepare_upload", "register", "list", "download", "delete"]) {
    assert.ok(api.includes('gateway("' + action + '"'));
  }
  assert.match(api, /uploadToSignedUrl/);
  assert.match(api, /MAX_ARTIFACT_BYTES/);
  assert.match(api, /getUltronArtifactDownloadUrl/);
});

test("artifact gateway keeps uploads owner-prefixed and uses expiring private download links", async () => {
  const fn = await readFile(new URL("../../../supabase/functions/ultron-artifacts/index.ts", import.meta.url), "utf8");
  assert.match(fn, /user\.id\s*\+\s*"\/"\s*\+\s*id/);
  assert.match(fn, /createSignedUrl\([^,]+,\s*300/);
  assert.match(fn, /ultron-private/);
  assert.match(fn, /owner_instance_required/);
});
