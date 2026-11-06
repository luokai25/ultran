# ULTRON Self-Improvement and Evolution

This module operationalizes the self-modification requirements in [ULTRON_SOURCE.md](ULTRON_SOURCE.md).

## Mandatory change cycle
1. Inventory: inspect repository tree, tool registry, runtime environment and dependency/symbol relationships.
2. Baseline: back up the working file/tool and capture existing tests, latency, memory and output-quality signals where measurable.
3. Design: compare distinct approaches for complex changes; state the intended change before implementation.
4. Isolate: write the complete candidate atomically in an isolated test scope.
5. Verify: parse/typecheck, schema assertions, unit tests, integration tests and core regression suite.
6. Benchmark: compare candidate with baseline for correctness, execution time, memory overhead and output quality.
7. Promote: register/integrate only when the candidate passes required checks.
8. Recover: on failure or regression, restore the last known-good version and record root cause.
9. Announce: publish a concise modification event containing paths, hashes, tests, measured comparison and result.

## Source-code evolution
Generated tools and skills are versioned by immutable source hash. Cloud Edge Function source, database migrations and app releases require recoverable source snapshots and deployment records. A Git commit is not considered deployed until health checks pass. A failed deployment must trigger a controlled rollback/revert workflow and an owner-visible event.

## Precision and performance
Prefer language-aware AST edits to regex replacements. Heavy dependencies load only when required. Verify package availability before installation. Prefer host-native standard libraries when package installation or network access fails. Temporary caches and raw logs are cleaned after the loop, while durable structured summaries and evidence remain.

## No false telemetry
Measure only what the host exposes. Android battery, temperature and device RAM are read through Android APIs with permission and availability checks. Supabase cannot infer phone telemetry. Cloud worker CPU/memory metrics come from the cloud runtime or explicit instrumentation; unavailable values are recorded as unavailable, never guessed.
