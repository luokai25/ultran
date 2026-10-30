/**
 * L1 - Local AI Brain Runtime: shared types.
 *
 * The runtime abstracts over inference backends so the orchestrator never
 * knows whether tokens come from llama.cpp, MLX, ONNX, or a remote fallback.
 */

export type BackendKind = 'ollama' | 'llama.cpp' | 'mlx' | 'onnx' | 'remote';

export interface ModelRef {
  /** Stable identifier, e.g. "qwen2.5-7b-instruct-q4_k_m". */
  id: string;
  backend: BackendKind;
  /** SHA-256 of the weight file. Loading is refused without a match. */
  sha256?: string;
  /** Context window in tokens. */
  contextWindow: number;
}

export interface LoadOptions {
  /** Quantization hint passed to the backend. */
  quantization?: string;
  /** Max resident memory in MB before eviction is forced. */
  memoryBudgetMb?: number;
  /** Keep pinned in memory; excluded from LRU eviction. */
  pin?: boolean;
}

export interface InferenceRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Constrain decoding to this JSON schema. */
  responseSchema?: Record<string, unknown>;
  stop?: string[];
}

export interface Token {
  text: string;
  /** True when the backend signals end-of-sequence. */
  done: boolean;
  index: number;
}

export interface ModelHandle {
  ref: ModelRef;
  loadedAt: number;
  tokensIn: number;
  tokensOut: number;
}

export interface BrainHealth {
  status: 'ok' | 'degraded' | 'down';
  loadedModels: Array<Pick<ModelHandle, 'ref' | 'tokensIn' | 'tokensOut'>>;
  residentMemoryMb: number;
}

/** The contract every inference backend must satisfy. */
export interface BrainBackend {
  readonly kind: BackendKind;
  load(ref: ModelRef, opts: LoadOptions): Promise<ModelHandle>;
  infer(handle: ModelHandle, req: InferenceRequest): AsyncIterable<Token>;
  embed(handle: ModelHandle, texts: string[]): Promise<Float32Array[]>;
  unload(handle: ModelHandle): Promise<void>;
}
