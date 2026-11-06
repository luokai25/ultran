# ULTRON Runtime and Infrastructure

This module operationalizes the runtime directives in [ULTRON_SOURCE.md](ULTRON_SOURCE.md).

## Phone and cloud
- Android owns device-only capabilities, local model loading, app-private files, and actual phone telemetry.
- Supabase is the default home for network-facing services, durable orchestration, schedules, memory coordination, artifact metadata and cloud tools when the function is better suited to cloud execution.
- Use short-lived REST/GraphQL or transaction-pooler database access. Every new table and query path must be owner-scoped and protected by RLS.
- Cloud work must be split into bounded Edge Function steps and durable jobs, not unbounded execution in a single request.

## Model/provider runtime
Provider credentials live in encrypted secret storage. The central provider registry owns validation status, model discovery, routing, fallback, observed usage and cooldown state. A provider key is never exposed to the phone UI, logs, tool source or model context. Provider availability and quota are based on observed responses, not assumptions.

## Tool runtime
All generated tools have a manifest, typed input schema, usage examples, dependency declaration, source hash, version, backup, test report, permission profile and owner-scoped audit history. Heavy imports are lazy. Tools run only in the appropriate isolated runtime; a metadata field is not proof of OS-level isolation.

## Storage and serialization
Durable memory stores concise semantic summaries and structured references rather than unbounded raw histories. Interactive debugging uses readable JSON/YAML; high-volume inter-process streams may use a compact binary encoding only where both endpoints support and validate it.

## Device telemetry
The phone reports available battery, RAM, thermal and CPU information through Android APIs. Resource-aware execution throttles local builds and model runs based on real reported values. Missing sensor APIs degrade gracefully.
