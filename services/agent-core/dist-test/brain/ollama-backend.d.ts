/**
 * Ollama inference adapter for the local-first brain.
 *
 * The adapter refuses to load a model unless the digest reported by the local
 * Ollama daemon matches ModelRef.sha256. Inference and embeddings stay on the
 * configured host; no remote provider is contacted by this backend.
 */
import type { BrainBackend, InferenceRequest, LoadOptions, ModelHandle, ModelRef, Token } from './types.js';
export interface OllamaBackendOptions {
    endpoint?: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
}
export declare class OllamaBackend implements BrainBackend {
    readonly kind: "ollama";
    private readonly endpoint;
    private readonly timeoutMs;
    private readonly fetcher;
    constructor(options?: OllamaBackendOptions);
    private request;
    /** List locally installed models and their Ollama-reported content digests. */
    listModels(): Promise<Array<{
        id: string;
        sha256: string;
    }>>;
    load(ref: ModelRef, _opts?: LoadOptions): Promise<ModelHandle>;
    infer(handle: ModelHandle, req: InferenceRequest): AsyncIterable<Token>;
    embed(handle: ModelHandle, texts: string[]): Promise<Float32Array[]>;
    unload(_handle: ModelHandle): Promise<void>;
}
//# sourceMappingURL=ollama-backend.d.ts.map