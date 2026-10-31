# Ultran mobile large-model inference

Status: first native low-memory stage implemented; multi-shard model management, true layer scheduling, accelerator paths, and on-device benchmarks remain staged work. This document records public-source analysis and the Android-specific port strategy. It does not claim that every AirLLM model or performance result has been reproduced on a phone.

## Upstream studied

- Project: https://github.com/lyogavin/airllm
- License: Apache-2.0
- Main implementation: `air_llm/airllm/airllm_base.py`
- Checkpoint preparation and storage: `air_llm/airllm/utils.py`
- Persistence adapters: `air_llm/airllm/persist/`
- Model-family mapping: `air_llm/airllm/auto_model.py` and architecture subclasses.

AirLLM's current implementation is a Hugging Face Transformers wrapper. It constructs model modules on the `meta` device so parameter allocation does not materialize the whole checkpoint, decomposes checkpoints into per-module SafeTensors shards, then attaches pre-forward and post-forward hooks. A hook loads the current module's tensor state from disk, moves it to the compute device, executes the normal Transformers module, and evicts the loaded tensors back to `meta`. A single-worker prefetch executor overlaps reading the next module with current compute. This preserves Transformers' forward, generation, attention, and KV-cache behavior instead of reimplementing each architecture's math.

### Internal pipeline details reviewed

The public source separates model-family discovery from the streaming engine:

- `AutoModel` reads the Hugging Face config's declared architecture and selects a dedicated subclass only for non-standard module layouts (ChatGLM, QWen, Baichuan, InternLM, Kimi K3, Qwen3.5 and Qwen4-Exp). Standard causal-LM layouts use the generic base class. The macOS path is separate and uses an MLX Llama/Mistral implementation.
- The checkpoint splitter reads the Hugging Face tensor index (or synthesizes one for a single SafeTensors/PyTorch checkpoint), maps parameter names to decoder modules, and writes one persistent shard per module. It sorts modules by the last source shard they touch so it can stream the original checkpoint sequentially without silently omitting tensors.
- Already-per-layer source shards can be reused as hard links when the source format matches the SafeTensors persister, avoiding a second copy of enormous checkpoints. The splitter also checks free disk space and can delete original files only when explicitly configured.
- The SafeTensors persister writes a completion marker per module and reuses a complete prior decomposition. The MLX persister is a separate NPZ-based path with Llama-style tensor-name conversion.
- The generic loader instantiates Transformers modules on `meta`, keeps non-checkpoint buffers materialized, moves one module's tensors to the compute device before its forward call, then returns the module's parameters to `meta` after execution. The next module can be prefetched on a worker thread.
- The expert path indexes tensor names inside a layer shard and reads only the selected expert tensors with SafeTensors random access. It falls back to whole-layer streaming when the architecture, persister, or compression mode cannot safely support expert hooks.
- Large CPU-resident lookup tables are extracted into raw file-backed mmap storage and gathered from the host. This is a distinct path from ordinary decoder-layer streaming.
- Compression, quantizer-specific parameter restoration, tied embeddings, multimodal resident modules, model-family path maps, and profiler timings are all separate compatibility concerns. They are not interchangeable with merely turning on mmap.

For sparse mixture-of-experts models, AirLLM can attach hooks to individual experts. The router selects a subset per token, so only selected experts are loaded. It keeps non-expert layer tensors separate. The implementation also has special handling for oversized embeddings: file-backed memory maps and indexed row gathers avoid materializing huge lookup tables. A profiler tracks per-layer load and compute costs. Persistence adapters keep the decomposed representation for warm starts. Some model families still need architecture-specific module-name maps and exceptions.

## Why the Python implementation is not copied into Android

AirLLM depends on Python, PyTorch, Transformers, Accelerate, SafeTensors and optional CUDA/MPS-specific components. Shipping that stack inside this Capacitor Android APK would be large, fragile, difficult to compile for the supported ABIs, and poorly matched to Android's process and memory lifecycle. The Android app already has a native llama.cpp runtime and GGUF model path. The port therefore uses llama.cpp's native model loader and file-backed tensor facilities, with the same high-level objective: keep the full checkpoint on storage and avoid eagerly copying all weights into process RAM.

## Mobile implementation already present

- Native loader selects `LLAMA_LOAD_MODE_MMAP`.
- Native loader selects `LLAMA_LAZY_MODE_AUTO`, which uses on-demand reads for tensor classes marked by the architecture when they exceed llama.cpp's documented threshold.
- Android no longer rejects a model merely because its file is larger than 70% of free RAM. The previous guard incorrectly assumed the full mapped checkpoint must be resident.
- The context cache is selected from current available memory: 512 tokens below 1 GiB free, 1,024 below 2 GiB, otherwise 2,048.
- Prompt batches are limited to 64 tokens to reduce transient allocations.
- Import and direct Hugging Face download have a 256 GB safety ceiling and still check actual free storage while writing a temporary file. Split GGUF imports are multi-selected, filename/count checked, staged, and committed as one set; the model list exposes only the first shard as the logical model. llama.cpp's pinned loader automatically discovers the remaining standard `-00001-of-000NN.gguf` files. This ceiling is not a promise that Android hardware can run a model of that size.
- Existing GGUF validation, SHA-256 validation when supplied, atomic finalization, serialized load/inference/delete operations, and local-only model storage remain in place.

## What Ultran's split import does and does not mean

The new multi-select import supports llama.cpp's standard multi-file GGUF
checkpoint convention. It validates and stores all files together so the
native loader can discover the remaining parts from the first shard. This is
**file sharding**, not AirLLM's **module decomposition**: it does not convert
a Hugging Face checkpoint into one SafeTensors file per transformer layer,
nor does it explicitly move a module to a device and return it to a meta state
after every forward. Those are separate future stages.

## Important distinction: mmap is not magic

Memory mapping reserves a virtual address range and lets the operating system fault pages in as they are accessed. It does not make the weights smaller, remove the need to read the weights for each token, or guarantee a fixed low resident set. On a phone, repeated layer reads can churn the page cache, and slow flash storage can make token generation painfully slow. Android may kill the app under memory pressure. The KV cache, tokenizer, compute scratch buffers, and at least the currently active tensor data still consume RAM. Thermal throttling can further reduce throughput.

AirLLM's headline low-VRAM results are GPU-backed laptop/server results. They must not be presented as verified mobile results. In particular, a 70B model that can be paged through a desktop GPU does not thereby become interactive on a 6 GB Android phone.

## Next engineering stages

1. **Multi-file GGUF model sets.** Treat split GGUF shards as one model, import all selected files atomically, verify every shard header and expected shard count, detect missing/duplicate indices, and expose one logical model entry. Test the pinned llama.cpp split-file loader.
2. **Model storage index.** Persist model metadata, all shard paths, total bytes, checksum state, quantization, architecture, tensor types, and provenance. Never delete an old working model until the replacement set is complete.
3. **Preflight planner.** Read GGUF metadata before loading. Estimate largest tensor, context/KV-cache cost, scratch buffers, and free storage. Recommend a safe context and explain likely latency rather than relying on file size alone.
4. **Layer-aware execution.** Measure whether llama.cpp's mmap/lazy path is sufficient on Android. If not, prototype a native tensor residency manager or dedicated backend that can evict/prefetch weight pages by execution order without duplicating model math. Do not port PyTorch hooks blindly.
5. **MoE-aware loading.** Detect architecture and expert tensor layout from GGUF metadata. Only add expert-level paging if the native graph exposes expert selection and weight residency safely.
6. **Storage and cache controls.** Add resumable downloads, per-shard hashes, LRU page-cache hints where supported, user-controlled model deletion, and disk-space reservation. Never silently delete source models.
7. **Mobile acceleration.** Benchmark CPU, Vulkan, and Android NNAPI/NPU possibilities per device. Do not advertise GPU/NPU acceleration until a supported backend is actually compiled and tested.
8. **Benchmark suite.** Record peak PSS/RSS, available RAM before/after, model load time, time-to-first-token, decode tokens/sec, storage read rate, battery drain, temperature, and app survival under memory pressure. Test 1B, 3B, 7B, 14B and larger models on real arm64 devices.
9. **Agent integration.** Keep the native model behind the existing Ultran capability and approval layers. Large-model inference must not bypass connector permissions, confirmation gates, audit records, or tool sandboxing.

## Acceptance criteria

- Existing small GGUF models still load and generate correctly.
- A model larger than currently free RAM is attempted through mmap rather than rejected by a file-size heuristic.
- A too-large context fails with an actionable message, not a crash.
- Split model sets are either completely verified and loadable or rejected without leaving partial files presented as a valid model.
- No network transfer occurs during local inference.
- No Ultran agent capability or approval behavior is weakened.
- Performance claims are based on reproducible measurements from physical Android devices, not extrapolated from GPU benchmarks.