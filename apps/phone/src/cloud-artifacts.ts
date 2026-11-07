import { cloudClient, getCloudSession } from "./cloud-sync";

export type UltronCloudArtifact = {
  id: string; name: string; description?: string | null; artifact_type: string;
  mime_type: string; byte_size: number; checksum_sha256?: string | null;
  source_job_id?: string | null; source_run_id?: string | null;
  metadata?: Record<string, unknown>; created_at: string; updated_at?: string;
};

const BUCKET = "ultron-private";
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function invokeArtifact(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using cloud artifacts.");
  const { data, error } = await cloudClient.functions.invoke("ultron-artifacts", { body: { ...payload, action } });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("ULTRON artifact service returned an invalid response.");
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.message ?? result.error));
  if (result.ok !== true) throw new Error("ULTRON artifact service did not confirm the operation.");
  return result;
}

async function checksumSha256(file: Blob): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return undefined; }
}

export async function createUltronCloudArtifact(input: {
  name: string; description?: string;
  artifactType: "pdf" | "report" | "archive" | "image" | "document" | "code" | "data" | "file";
  mimeType: string; file: Blob; sourceJobId?: string; sourceRunId?: string;
  metadata?: Record<string, unknown>;
}): Promise<UltronCloudArtifact> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before storing artifacts.");
  const name = input.name.trim();
  if (!name || name.length > 240) throw new Error("Artifact name must contain 1-240 characters.");
  if (!Number.isSafeInteger(input.file.size) || input.file.size < 1 || input.file.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Cloud artifacts must be between 1 byte and 50 MB.");
  }
  if (input.sourceJobId && !UUID_PATTERN.test(input.sourceJobId)) throw new Error("Invalid source job identifier.");
  if (input.sourceRunId && !UUID_PATTERN.test(input.sourceRunId)) throw new Error("Invalid source run identifier.");

  const prepared = await invokeArtifact("prepare_upload", {
    name, mime_type: input.mimeType.slice(0, 160), byte_size: input.file.size, artifact_type: input.artifactType,
  });
  const id = String(prepared.artifact_id ?? ""), path = String(prepared.path ?? ""), token = String(prepared.token ?? "");
  if (!UUID_PATTERN.test(id) || !path.startsWith(session.user.id + "/" + id + "/") || !token) {
    throw new Error("ULTRON returned an invalid private upload grant.");
  }
  const bucket = cloudClient.storage.from(BUCKET);
  const { error: uploadError } = await bucket.uploadToSignedUrl(path, token, input.file, {
    contentType: input.mimeType.slice(0, 160), upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    const checksum = await checksumSha256(input.file);
    const registered = await invokeArtifact("register", {
      id, storage_path: path, name, description: input.description?.slice(0, 2000),
      artifact_type: input.artifactType, mime_type: input.mimeType.slice(0, 160),
      ...(checksum ? { checksum_sha256: checksum } : {}),
      ...(input.sourceJobId ? { source_job_id: input.sourceJobId } : {}),
      ...(input.sourceRunId ? { source_run_id: input.sourceRunId } : {}),
      metadata: input.metadata ?? {},
    });
    const artifact = registered.artifact as UltronCloudArtifact | undefined;
    if (!artifact || artifact.id !== id) throw new Error("ULTRON stored the file but did not return its artifact record.");
    return artifact;
  } catch (error) {
    await bucket.remove([path]).catch(() => undefined);
    throw error;
  }
}

export async function listUltronCloudArtifacts(limit = 50): Promise<UltronCloudArtifact[]> {
  const result = await invokeArtifact("list", { limit: Math.max(1, Math.min(100, Math.trunc(limit) || 50)) });
  return Array.isArray(result.artifacts) ? result.artifacts as UltronCloudArtifact[] : [];
}

export async function getUltronCloudArtifactUrl(id: string, inline = false): Promise<string> {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid cloud artifact identifier.");
  const result = await invokeArtifact("download", { id, inline });
  const url = typeof result.url === "string" ? result.url : "";
  if (!/^https:\/\//i.test(url)) throw new Error("ULTRON did not return a valid signed artifact URL.");
  return url;
}

export async function deleteUltronCloudArtifact(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid cloud artifact identifier.");
  await invokeArtifact("delete", { id });
}
