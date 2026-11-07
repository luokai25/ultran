import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const client = read("apps/phone/src/cloud-artifacts.ts");
const app = read("apps/phone/src/main.ts");
const edge = read("supabase/functions/ultron-artifacts/index.ts");

assert.match(client, /functions\.invoke\("ultron-artifacts"/);
assert.match(client, /prepare_upload/);
assert.match(client, /uploadToSignedUrl/);
assert.match(client, /bucket\.remove/);
assert.match(client, /register/);
assert.match(client, /listUltronCloudArtifacts/);
assert.match(client, /getUltronCloudArtifactUrl/);
assert.match(client, /deleteUltronCloudArtifact/);
assert.match(client, /ultron-private/);
assert.match(edge, /body\.action==="prepare_upload"/);
assert.match(edge, /body\.action==="register"/);
assert.match(edge, /body\.action==="list"/);
assert.match(edge, /body\.action==="download"/);
assert.match(edge, /body\.action==="delete"/);
assert.match(edge, /const inline=body\.inline===true/);
assert.match(edge, /download:inline\?false:artifact\.name/);
assert.match(app, /ultron-artifact:\/\//);
assert.match(app, /createUltronCloudArtifact/);
assert.match(app, /listUltronCloudArtifacts/);
assert.match(app, /Supabase cloud ·/);
assert.match(app, /cancelUltronJob/);
assert.match(app, /deleteUltronCloudArtifact/);
assert.equal((app.match(/function artifactMimeType\\(/g) ?? []).length, 1);
assert.equal((app.match(/function artifactTypeForFormat\\(/g) ?? []).length, 1);

console.log("ULTRON private artifact upload, preview, download, delete and workspace contracts passed.");
