/**
 * Capability diagnostics deliberately separate catalogue presence from actual
 * execution. A schema is not proof that a handler, session, grant, or successful
 * end-to-end run exists.
 */
import type { ToolSchema } from './manifest.js';

export type CapabilityState =
  | 'registered'
  | 'missing_handler'
  | 'unavailable'
  | 'unauthorized'
  | 'unverified'
  | 'verified';

export interface CapabilityEvidence {
  /** Tool IDs with a real executor/handler registered. */
  implementedToolIds?: Iterable<string>;
  /** Tool IDs whose required runtime/session is currently reachable. */
  availableToolIds?: Iterable<string>;
  /** Tool IDs with a current grant for the requested principal/session. */
  authorizedToolIds?: Iterable<string>;
  /** Tool IDs with a recent successful execution verified by the host. */
  verifiedToolIds?: Iterable<string>;
  /** Host-provided explanation keyed by tool ID. */
  reasons?: Readonly<Record<string, string>>;
  /** ISO timestamp of this diagnostic snapshot, if supplied by the host. */
  checkedAt?: string;
}

export interface CapabilityStatus {
  toolId: string;
  capability: string;
  registered: true;
  implemented: boolean;
  available: boolean;
  authorized: boolean;
  verified: boolean;
  state: CapabilityState;
  reason?: string;
  checkedAt?: string;
}

function asSet(values: Iterable<string> | undefined): Set<string> {
  return new Set(values ?? []);
}

/**
 * Produces an honest per-tool snapshot. Missing evidence always means false;
 * callers must not infer execution availability from registration alone.
 */
export function diagnoseCapabilities(
  tools: ToolSchema[],
  evidence: CapabilityEvidence = {},
): CapabilityStatus[] {
  const implemented = asSet(evidence.implementedToolIds);
  const available = asSet(evidence.availableToolIds);
  const authorized = asSet(evidence.authorizedToolIds);
  const verified = asSet(evidence.verifiedToolIds);

  return tools.map((tool) => {
    const hasHandler = implemented.has(tool.id);
    const isAvailable = hasHandler && available.has(tool.id);
    const isAuthorized = isAvailable && authorized.has(tool.id);
    const isVerified = isAuthorized && verified.has(tool.id);

    let state: CapabilityState = 'registered';
    if (!hasHandler) state = 'missing_handler';
    else if (!isAvailable) state = 'unavailable';
    else if (!isAuthorized) state = 'unauthorized';
    else if (!isVerified) state = 'unverified';
    else state = 'verified';

    return {
      toolId: tool.id,
      capability: tool.capability,
      registered: true,
      implemented: hasHandler,
      available: isAvailable,
      authorized: isAuthorized,
      verified: isVerified,
      state,
      ...(evidence.reasons?.[tool.id] ? { reason: evidence.reasons[tool.id] } : {}),
      ...(evidence.checkedAt ? { checkedAt: evidence.checkedAt } : {}),
    };
  });
}
