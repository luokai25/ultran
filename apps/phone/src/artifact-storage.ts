import { cloudClient, getCloudSession } from "./cloud-sync";

export type UltronArtifactType = "pdf" | "report" | "archive" | "image" | "document" | "code" | "data" | "file";
export type UltronArtifact = {
  id: string; name: string; description?: string | null; artifact_type: UltronArtifactType;
  mime_type: string; byte_size: number; checksum_sha256?: string | null;
  source_job_id?: string | null; source_run_id?: string | null; metadata?: Record<string, unknown>;
  created_at: string;
};
type GatewayResult = Record<string, unknown>;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

async function gateway(action: string, payload: Record<string, unknown> = {}): Promise<GatewayResult> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using cloud artifacts.");
  const { data, error } = await cloudClient.functions.invoke("ultron-artifacts", { body: { ...payload, action } });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("ULTRON artifact service returned an invalid response.");
  const result = data as GatewayResult;
  if (result.error) throw new Error(String(result.message ?? result.error));
  if (result.ok !== true) throw new Error("ULTRON artifact service did not confirm the operation.");
  return result;
}

export async function uploadUltronArtifact(file: File, options: {
  artifact_type?: UltronArtifactType; description?: string; source_job_id?: string;
  source_run_id?: string; metadata?: Record<string, unknown>; checksum_sha256?: string;
} = {}): Promise<UltronArtifact> {
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Cloud artifacts must be between 1 byte and 50 MB.");
  }
  const prepared = await gateway("prepare_upload", {
    name: file.name || "artifact", mime_type: file.type || "application/octet-stream",
    byte_size: file.size, artifact_type: options.artifact_type ?? "file",
  });
  const path = String(prepared.path ?? "");
  const token = String(prepared.token ?? "");
  if (!path || !token) throw new Error("Artifact service did not return a signed upload target.");
  const { error: uploadError } = await cloudClient.storage.from("ultron-private")
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) throw uploadError;
  const registered = await gateway("register", {
    id: prepared.artifact_id, storage_path: path, name: file.name || "artifact",
    mime_type: file.type || "application/octet-stream", artifact_type: options.artifact_type ?? "file",
    description: options.description, source_job_id: options.source_job_id,
    source_run_id: options.source_run_id, metadata: options.metadata ?? {},
    checksum_sha256: options.checksum_sha256,
  });
  return registered.artifact as UltronArtifact;
}

export async function listUltronArtifacts(options: { artifact_type?: UltronArtifactType; limit?: number } = {}): Promise<UltronArtifact[]> {
  const result = await gateway("list", options);
  return Array.isArray(result.artifacts) ? result.artifacts as UltronArtifact[] : [];
}

export async function getUltronArtifactDownloadUrl(id: string): Promise<{ url: string; expires_in: number; mime_type: string }> {
  if (!id) throw new Error("Artifact ID is required.");
  const result = await gateway("download", { id });
  return { url: String(result.url), expires_in: Number(result.expires_in), mime_type: String(result.mime_type) };
}

export async function deleteUltronArtifact(id: string): Promise<void> {
  if (!id) throw new Error("Artifact ID is required.");
  await gateway("delete", { id });
}
