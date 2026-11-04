import { cloudClient, getCloudSession } from "./cloud-sync";

export async function invokeUltronRuntime(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using the cloud runtime.");
  const { data, error } = await cloudClient.functions.invoke("ultron-runtime", { body: { ...payload, action } });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("ULTRON cloud runtime returned an invalid response.");
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.message ?? result.error));
  return result;
}
