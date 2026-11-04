/**
 * L1 - Local AI Brain Runtime.
 *
 * A supervisor around pluggable BrainBackend implementations. It owns model
 * lifecycle (verify, load, serve, evict) and enforces the rule that no model
 * is ever loaded without a verified content hash.
 */
import type { BrainBackend, BrainHealth, InferenceRequest, LoadOptions, ModelHandle, ModelRef, Token } from './types.js';
export interface BrainRuntimeOptions {
    backends: BrainBackend[];
    /** Total resident memory allowed across all loaded models. */
    memoryBudgetMb?: number;
}
export declare class BrainRuntime {
    private readonly backends;
    private readonly loaded;
    private readonly memoryBudgetMb;
    constructor(opts: BrainRuntimeOptions);
    /**
     * Load a model, refusing any reference without a checksum.
     *
     * TODO: stream weights from the local cache, verify sha256, then hand off.
     */
    load(ref: ModelRef, opts?: LoadOptions): Promise<ModelHandle>;
    /** Stream tokens from a loaded model. */
    infer(refOrId: ModelRef | string, req: InferenceRequest): AsyncIterable<Token>;
    /** Compute embeddings using a dedicated embedding model. */
    embed(refOrId: ModelRef | string, texts: string[]): Promise<Float32Array[]>;
    unload(id: string): Promise<void>;
    health(): Promise<BrainHealth>;
    /** LRU eviction once the memory budget is exceeded. */
    private evictIfNeeded;
}
//# sourceMappingURL=runtime.d.ts.map