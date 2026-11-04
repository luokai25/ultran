# ULTRON Prometheus Runtime

This document records the implementation boundary for ULTRON'\''s self-improving runtime. "Prometheus Loop" is the project name for the controlled lifecycle below, not a claim that generated code can safely execute itself.

## Generated capability lifecycle

1. A candidate is parsed and reviewed by `generated_tool_policy.py`. The supported language is intentionally small: one `run(payload)` function, no imports, attribute access, filesystem, network, dynamic evaluation, or ambient authority.
2. The candidate is fingerprinted by tool id, semantic version, and exact source SHA-256.
3. The content-addressed artifact store stages source and a review manifest with private file permissions. The worker adapter may then stage the reviewed bytes. Staging is not execution.
4. A separate worker supervisor starts a restricted worker and returns an attestation tied to tool id, version, source hash, isolation profile, network setting, and ambient-credential setting.
5. ULTRON requires an exact human approval fingerprint.
6. The MCP manifest is hot-registered in the in-memory connector registry. Generated source is never imported by the trusted API process.
7. Rollback/unload removes the manifest and asks the worker adapter to stop the worker.

The lifecycle coordinator defines and tests this contract. A production worker adapter still has to implement real OS/container isolation, resource quotas, filesystem scoping, process supervision, and trustworthy readiness attestation. A string field claiming isolation is not itself isolation.

## Repair policy

`generated-tool-repair.ts` classifies failures and bounds candidate repair to two attempts. Only proven pre-execution syntax/schema defects may regenerate a candidate automatically. Each replacement must pass source review and isolated regression tests and remains pending exact-source approval.

- Dependency changes require explicit approval.
- Security, permission, and authentication failures stop.
- A write with an ambiguous result is never replayed.
- Network retry is only a recommendation for trusted read-only operations and requires a fresh policy check and single-use grant.
- Timeouts and resource failures are not blindly retried.

The repair helper is a candidate pipeline, not permission to patch a live tool in place. The current agent orchestrator does not automatically retry arbitrary failed tool invocations.

## Paired-node protocol and replicated memory

`peer_protocol.py` provides explicit pairing, endpoint validation, HMAC-SHA256 message authentication with a 32-byte out-of-band pairing key, clock-skew checks, replay protection, a payload limit, a method allow-list, and per-peer request quotas. Keys must be transferred through a trusted pairing channel and protected at rest. No LAN discovery or automatic peer trust is implemented.

`peer_dispatcher.py` accepts only `health.ping` and `memory.merge`. It rejects tool execution, shell commands, deployments, and arbitrary RPC methods. It is transport-independent; a production WebSocket adapter and authenticated pairing UI are still required before peers can communicate over a network.

`replicated_state.py` is a state-only, append-only event log with Lamport clocks, deterministic last-writer-wins conflict resolution, tombstones, duplicate suppression, and convergence tests. It is not Paxos/Raft and does not claim consensus. Replicated state never replays external actions. The current in-memory event log is bounded; durable snapshot compaction and encrypted persistence remain future adapter work.

## Local system boundary

Android/Linux native adapters should use supported OS APIs and app-scoped permissions. ULTRON must not bypass Android'\''s permission model or use direct syscalls/ioctl as a privilege shortcut. Existing Android native code uses `Os.chmod`, `Os.symlink`, and `Os.lstat` for private runtime installation and filesystem metadata; these do not grant root or bypass the app sandbox.

## Embedding status

The phone'\''s current tiered memory index uses deterministic feature hashing and lexical/freshness/confidence signals. This is a low-cost fallback, not a neural embedding model. A neural provider is not considered active until an actual local model is loaded, its dimensions and outputs are validated, and retrieval uses that same provider for both stored records and queries.
