/**
 * Device sync.
 *
 * The client keeps a local journal (L0). When connectivity allows, batches of
 * journal operations are pushed here and merged. Conflicts resolve
 * last-writer-wins per field, keyed by device id and logical clock.
 */

export interface JournalOp {
  /** Logical clock; monotonically increasing per device. */
  seq: number;
  deviceId: string;
  entity: string;
  entityId: string;
  patch: Record<string, unknown>;
  at: number;
}

export interface SyncResponse {
  accepted: number;
  rejected: number;
  /** Server clock so the client can bound its next push. */
  serverTime: number;
}

/**
 * Ingest a batch of journal operations.
 *
 * TODO: persist, dedupe by (deviceId, seq), and resolve conflicts.
 */
export async function ingestBatch(ops: JournalOp[]): Promise<SyncResponse> {
  return {
    accepted: ops.length,
    rejected: 0,
    serverTime: Date.now(),
  };
}
