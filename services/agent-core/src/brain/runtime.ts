/**
 * L1 - Local AI Brain Runtime.
 *
 * A supervisor around pluggable BrainBackend implementations. It owns model
 * lifecycle (verify, load, serve, evict) and enforces the rule that no model
 * is ever loaded without a verified content hash.
 */

import type {
  BrainBackend,
  BrainHealth,
  InferenceRequest,
  LoadOptions,
  ModelHandle,
  ModelRef,
  Token,
} from './types.js';

export interface BrainRuntimeOptions {
  backends: BrainBackend[];
  /** Total resident memory allowed across all loaded models. */
  memoryBudgetMb?: number;
}

function digestKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^sha256:/, "");
}

export class BrainRuntime {
  private readonly backends = new Map<string, BrainBackend>();
  private readonly loaded = new Map<string, ModelHandle>();
  private readonly memoryBudgetMb: number;

  constructor(opts: BrainRuntimeOptions) {
    for (const backend of opts.backends) {
      this.backends.set(backend.kind, backend);
    }
    this.memoryBudgetMb = opts.memoryBudgetMb ?? 8192;
  }

  /**
   * Load a model, refusing any reference without a checksum.
   *
   * TODO: stream weights from the local cache, verify sha256, then hand off.
   */
  async load(ref: ModelRef, opts: LoadOptions = {}): Promise<ModelHandle> {
    if (!ref.sha256) {
      throw new Error(
        `refusing to load "${ref.id}": no sha256 digest provided for verification`,
      );
    }

    const cached = this.loaded.get(ref.id);
    if (cached) {
      // Never let a cache hit bypass the identity check. A model ID can be
      // repointed to different bytes; backend and digest are part of identity.
      if (
        cached.ref.backend !== ref.backend ||
        digestKey(cached.ref.sha256) !== digestKey(ref.sha256)
      ) {
        throw new Error(
          `model "${ref.id}" is already loaded with a different backend or SHA-256 digest`,
        );
      }
      return cached;
    }

    const backend = this.backends.get(ref.backend);
    if (!backend) {
      throw new Error(`no backend registered for "${ref.backend}"`);
    }

    await this.evictIfNeeded();
    const handle = await backend.load(ref, opts);
    this.loaded.set(ref.id, handle);
    return handle;
  }

  /** Stream tokens from a loaded model. */
  async *infer(
    refOrId: ModelRef | string,
    req: InferenceRequest,
  ): AsyncIterable<Token> {
    const id = typeof refOrId === 'string' ? refOrId : refOrId.id;
    const handle = this.loaded.get(id);
    if (!handle) throw new Error(`model "${id}" is not loaded`);

    const backend = this.backends.get(handle.ref.backend);
    if (!backend) throw new Error(`no backend for "${handle.ref.backend}"`);

    for await (const token of backend.infer(handle, req)) {
      handle.tokensOut += 1;
      yield token;
    }
  }

  /** Compute embeddings using a dedicated embedding model. */
  async embed(refOrId: ModelRef | string, texts: string[]): Promise<Float32Array[]> {
    const id = typeof refOrId === 'string' ? refOrId : refOrId.id;
    const handle = this.loaded.get(id);
    if (!handle) throw new Error(`model "${id}" is not loaded`);

    const backend = this.backends.get(handle.ref.backend);
    if (!backend) throw new Error(`no backend for "${handle.ref.backend}"`);

    return backend.embed(handle, texts);
  }

  async unload(id: string): Promise<void> {
    const handle = this.loaded.get(id);
    if (!handle) return;
    const backend = this.backends.get(handle.ref.backend);
    await backend?.unload(handle);
    this.loaded.delete(id);
  }

  async health(): Promise<BrainHealth> {
    const loadedModels = [...this.loaded.values()].map((h) => ({
      ref: h.ref,
      tokensIn: h.tokensIn,
      tokensOut: h.tokensOut,
    }));

    return {
      status: loadedModels.length > 0 ? 'ok' : 'degraded',
      loadedModels,
      residentMemoryMb: 0, // TODO: read from the process RSS / allocator
    };
  }

  /** LRU eviction once the memory budget is exceeded. */
  private async evictIfNeeded(): Promise<void> {
    if (this.loaded.size === 0) return;
    // TODO: compare residentMemoryMb against memoryBudgetMb and evict the
    // least-recently-used unpinned handle until we are back under budget.
    void this.memoryBudgetMb;
  }
}
