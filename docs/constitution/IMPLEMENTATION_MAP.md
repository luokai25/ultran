# ULTRON Source-to-System Implementation Map

The governing source is [ULTRON_SOURCE.md](ULTRON_SOURCE.md). The modules in this folder organize it; they do not supersede it.

| Source requirement | System implementation target | Current evidence / gap |
|---|---|---|
| Immutable loyalty laws | Core identity policy + owner-controlled immutable configuration | Policy documented here; runtime enforcement still needs tests across every prompt/tool/sub-agent boundary |
| Missing CLI/API/tool auto-build | Capability inventory, discovery, candidate builder, test and registration pipeline | Generated tool lifecycle documented in `docs/ultron-prometheus-runtime.md`; production isolation adapter still incomplete |
| Backup, isolated tests, rollback | Versioned snapshots, candidate workspace, regression suite, promotion/rollback events | Existing generated tool lifecycle; full deployed Edge Function and Android source recovery still needs implementation |
| Performance comparison | Baseline/candidate timing, memory and output-quality measurements | Not yet a complete unified benchmark service |
| Persistent tool inventory | Owner-scoped registry of tools, skills, arguments, examples, hashes and dependencies | Existing generated capability tables; needs complete inventory reconciliation |
| AST-aware modifications and symbol graph | Language parsers, dependency graph and blast-radius analysis | Not yet a complete bidirectional repository symbol graph |
| Progress streaming and interruption resume | Durable run ledger, append-only events, checkpoints and scheduled worker | Phone Prometheus loop currently checkpoints but its model loop stops when the app closes; cloud continuation worker remains a priority |
| Host telemetry | Android telemetry bridge + cloud worker instrumentation | Must be read from the host that owns the resource; no invented cross-host telemetry |
| Supabase-first network functions | Edge Functions, RLS migrations, cron and short-lived database access | Existing Supabase functions and scheduled maintenance; verify every new path with owner-scoped tests |
| Revenue and financial ledger | Opportunity research, cost/revenue ledger, payment webhook reconciliation | Strategic requirements documented; ledger coverage and autonomous commercial monitoring require implementation |
| Unified sub-agent ledger | Shared run/event ledger with scoped child-run references | Target contract documented; verify all sub-agent dispatch paths write to it |
| Untrusted external text | Data-only treatment, injection filtering, capability allow-list | Existing tool policy and connector approval path; add adversarial regression coverage |

## Non-negotiable operating rule
Every capability claim must be backed by a code path, deployed service, passing test or observable runtime result. A prompt or document alone does not create a worker, grant an OS permission, install a dependency, deploy a function, or authorize a financial transaction.

## Progress reporting format
Significant work emits concise events: `intent`, `backup_created`, `candidate_staged`, `tests_started`, `tests_passed` / `tests_failed`, `promoted` / `rolled_back`, and `owner_notice`. Store outputs, hashes and artifact references; do not expose private chain-of-thought.
