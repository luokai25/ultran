/** Typed client for the Ultran control plane. */

export const API_BASE = process.env.NEXT_PUBLIC_ULTRAN_API ?? "http://127.0.0.1:8080/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "api_error",
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Connector = {
  id: string;
  name: string;
  category: string;
  auth_kind: string;
  tier: "free" | "paid";
  actions: string[];
  description: string;
};

export type Agent = {
  id: string;
  name: string;
  persona: string;
  brain: string;
  model: string;
  tools: string[];
  enabled: boolean;
  total_runs: number;
  total_tokens: number;
};

export type Usage = {
  account_id: string;
  plan: string;
  tokens_used: number;
  tokens_allowance: number;
  percent_used: number;
  remaining: number;
};

export type Plan = {
  id: string;
  name: string;
  monthly_tokens: number;
  price_usd_cents: number;
  connector_limit: number;
  features: string[];
};

export type BuildArtifact = {
  id: string;
  slug: string;
  target: string;
  template: string;
  files: Record<string, string>;
  file_count: number;
  bytes: number;
};

export type ForgeResult = {
  name: string;
  kind: string;
  ok: boolean;
  diagnostics: string[];
  export: Record<string, unknown>;
  checksum: string;
};

export type AvatarState = {
  persona: string;
  scene: string;
  emotion: string;
  position: [number, number, number];
  palette: Record<string, string>;
};

export type VoiceRendered = {
  voice: string;
  duration_s: number;
  syllables: number;
  phonemes: string[];
  ssml: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Ultran-Workspace": "local",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
    throw new ApiError(err?.message ?? `request failed (${res.status})`, res.status, err?.code, err?.details);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),
  capabilities: () => request<Record<string, unknown>>("/capabilities"),

  connectors: (params: Record<string, string> = {}) =>
    request<Connector[]>(`/connectors?${new URLSearchParams(params)}`),
  connectorStats: () =>
    request<{ total: number; free: number; paid: number; categories: Record<string, number> }>(
      "/connectors/stats",
    ),
  enabledConnectors: () => request<{ enabled: string[] }>("/connectors/enabled/list"),
  enableConnector: (id: string) =>
    request<void>(`/connectors/${id}/enable`, { method: "POST" }),
  connectConnector: (connectorId: string, apiKey: string, plan: "free" | "paid" = "free") =>
    request<{ connector_id: string; masked_key: string; fingerprint: string }>("/connectors/connect", {
      method: "POST",
      body: JSON.stringify({ connector_id: connectorId, api_key: apiKey, plan }),
    }),

  agents: () => request<Agent[]>("/agents"),
  createAgent: (name: string, tools: string[] = []) =>
    request<Agent>("/agents", { method: "POST", body: JSON.stringify({ name, tools }) }),
  chat: (agentId: string, message: string, sessionId?: string) =>
    request<{ session_id: string; content: string; tokens_in: number; tokens_out: number }>(
      `/agents/${agentId}/chat`,
      { method: "POST", body: JSON.stringify({ message, session_id: sessionId }) },
    ),

  avatar: () => request<AvatarState>("/workspace/avatar"),
  moveAvatar: (scene: string, emotion: string) =>
    request<AvatarState>("/workspace/avatar/move", {
      method: "POST",
      body: JSON.stringify({ scene, emotion, x: 0, y: 0, z: 0 }),
    }),
  speak: (text: string, voice = "ultron") =>
    request<VoiceRendered>("/workspace/voice/speak", {
      method: "POST",
      body: JSON.stringify({ text, voice }),
    }),

  build: (target: string, template: string, slug: string, features: string[] = []) =>
    request<BuildArtifact>("/builder/build", {
      method: "POST",
      body: JSON.stringify({ target, template, slug, features }),
    }),

  forge: (name: string, kind: string, source: string) =>
    request<ForgeResult>("/forge/compile", {
      method: "POST",
      body: JSON.stringify({ name, kind, source }),
    }),

  plans: () => request<Plan[]>("/billing/plans"),
  usage: () => request<Usage>("/billing/usage"),
  subscribe: (plan: string) =>
    request<Usage>("/billing/subscribe", { method: "POST", body: JSON.stringify({ plan }) }),
  charge: (amountCents: number, memo: string, idempotencyKey?: string) =>
    request<{ id: string; balance_cents: number }>("/billing/charges", {
      method: "POST",
      body: JSON.stringify({ amount_cents: amountCents, memo, idempotency_key: idempotencyKey }),
    }),
};
