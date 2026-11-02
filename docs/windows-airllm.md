# Ultran on Windows + AirLLM

This adds a first Windows companion inference runtime to the existing Ultran
monorepo. It does not replace Android and does not bypass agent-core approvals,
connector permissions, or audit policies.

## Hardware reality

The reported HP ProBook 4545s has an AMD A6-4400M (2 CPU cores) and Radeon HD
graphics. The launcher deliberately installs CPU-only PyTorch. AirLLM can reduce
peak model memory by streaming layers, but it does not make large models fast or
eliminate RAM, disk, and model-compatibility requirements. On this laptop, start
with a small model for a smoke test; 27B/70B models are an experiment, not a
realistic interactive target.

## Setup

1. Install 64-bit Python 3.11 and Git.
2. Open PowerShell in the repository root.
3. Run:

   Set-ExecutionPolicy -Scope Process Bypass
   .\tools\airllm-windows\start-ultran-airllm.ps1

4. The bridge binds to loopback at http://127.0.0.1:11435.
5. Check /health and /v1/models in the browser.

Runtime setup now imports and verifies PyTorch, Transformers, AirLLM, FastAPI, and Uvicorn before it reports success. The first chat request downloads model weights and AirLLM layer shards. Keep ample free disk space; budget at least twice the checkpoint size where possible. Hugging Face's cache handles resumable file downloads, but an interrupted first load may need to be retried. The first request can be extremely slow, especially on CPU.

Set ULTRAN_AIRLLM_MODEL before launching to select another compatible Hugging
Face model. Some repositories require authentication or license acceptance. Do
not put access tokens in source code or commit them.

## API

- GET /health
- GET /v1/models
- POST /v1/chat/completions

The API is loopback-only by default. Do not bind it to 0.0.0.0 or expose it to
the internet. The current Ultran UI's Ollama endpoint setting is not
automatically compatible with this OpenAI-style route. The next UI integration
should add an explicit AirLLM/OpenAI-compatible local provider while preserving
task approval and logging.

## Troubleshooting

Check /health for the load error, Python version, model support, and free disk.
CPU-only is expected on this AMD laptop. If generation is too slow, use a
smaller model or run inference on stronger hardware and connect only over a
trusted private network with authentication. Do not expose this unauthenticated
development bridge.