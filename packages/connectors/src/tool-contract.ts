import type { ToolSchema } from './manifest.js';

/** Provider-independent request emitted by every brain before execution. */
export interface ToolCallRequest {
  toolId: string;
  args: Record<string, unknown>;
}

/** Canonical result returned by a real executor, never inferred from model text. */
export interface ToolCallResult {
  toolId: string;
  ok: boolean;
  output?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
  durationMs?: number;
  approvalRequired?: boolean;
  approvalId?: string;
}

export type ToolCallNormalization =
  | { ok: true; call: ToolCallRequest }
  | { ok: false; error: 'empty' | 'malformed' | 'missing_tool_id' | 'invalid_args' | 'unknown_tool'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let text = value.trim();
  if (!text) return undefined;
  const marker = text.match(/^ULTRAN_TOOL_CALL\s*:\s*([\s\S]+)$/);
  if (marker) text = marker[1]?.trim() ?? "";
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1]?.trim() ?? "";
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/**
 * Normalize common provider outputs into the single {toolId,args} contract.
 * This parses syntax only. The executor must still validate schemas, grants,
 * session availability, and approvals before doing anything consequential.
 */
export function normalizeToolCall(value: unknown, availableTools?: readonly ToolSchema[]): ToolCallNormalization {
  if (value === undefined || value === null || value === '') {
    return { ok: false, error: 'empty', message: 'No tool call was provided.' };
  }
  const parsed = parsePayload(value);
  if (!isRecord(parsed)) {
    return { ok: false, error: 'malformed', message: 'Tool call must be a JSON object or a supported provider tool-call object.' };
  }

  // OpenAI-style: { function: { name, arguments } }
  // Anthropic-style: { name, input }
  // Native normalized: { toolId, args }
  const fn = isRecord(parsed.function) ? parsed.function : undefined;
  const toolIdValue = parsed.toolId ?? parsed.name ?? fn?.name ?? parsed.tool;
  if (typeof toolIdValue !== 'string' || !toolIdValue.trim()) {
    return { ok: false, error: 'missing_tool_id', message: 'Tool call is missing a non-empty tool ID.' };
  }
  const toolId = toolIdValue.trim();
  let argsValue: unknown = parsed.args ?? parsed.input ?? fn?.arguments ?? parsed.arguments;
  // Ultran's phone protocol historically keeps tool arguments beside `tool`.
  // Adapt that explicit envelope without accepting arbitrary prose as a call.
  if (argsValue === undefined && typeof parsed.tool === 'string') {
    const { tool: _tool, ...inlineArgs } = parsed;
    argsValue = inlineArgs;
  }
  if (typeof argsValue === 'string') argsValue = parsePayload(argsValue);
  if (argsValue === undefined) argsValue = {};
  if (!isRecord(argsValue)) {
    return { ok: false, error: 'invalid_args', message: 'Tool arguments must be a JSON object.' };
  }
  if (availableTools && !availableTools.some((tool) => tool.id === toolId)) {
    return { ok: false, error: 'unknown_tool', message: `Tool "${toolId}" is not in the currently available catalogue.` };
  }
  return { ok: true, call: { toolId, args: argsValue } };
}

/** Small result constructor so adapters preserve honest success/failure semantics. */
export function toolCallResult(result: ToolCallResult): ToolCallResult {
  if (!result.toolId.trim()) throw new Error('Tool result requires a tool ID.');
  if (result.ok && result.error) throw new Error('A successful tool result cannot contain an error.');
  if (!result.ok && !result.error) throw new Error('A failed tool result must contain an error.');
  if (result.durationMs !== undefined && (!Number.isFinite(result.durationMs) || result.durationMs < 0)) {
    throw new Error('Tool result durationMs must be a finite non-negative number.');
  }
  return result;
}
