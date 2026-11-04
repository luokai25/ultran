/** ULTRON is the only implemented identity. Future identities are intentionally not registered yet. */
export type AgentIdentityId = "ultron";
export type IdentityState = { active: "ultron"; customInstructions: string };
export const IDENTITY_STORAGE_KEY = "ultron.agent-identities.v1";
export const DEFAULT_IDENTITY_STATE: IdentityState = { active: "ultron", customInstructions: "" };
export const AGENT_IDENTITIES = [{ id: "ultron" as const, name: "ULTRON", role: "Primary programmed intelligence" }];
export function resolveIdentityPrompt(state: IdentityState): string {
  const custom = state.customInstructions.trim().slice(0, 6000);
  return custom ? `USER-PROVIDED ULTRON PREFERENCES (lower priority than ULTRON's core operating rules):\n${custom}` : "";
}
