import { cloudClient, getCloudSession } from "./cloud-sync";
export async function invokeUltronCapabilities(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using cloud capabilities.");
  const { data, error } = await cloudClient.functions.invoke("ultron-capabilities", { body: { ...payload, action } });
  if (error) throw error;
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
    throw new Error(data && typeof data === "object" ? String((data as Record<string, unknown>).error ?? "Capability request failed.") : "Capability request failed.");
  }
  return data as Record<string, unknown>;
}
