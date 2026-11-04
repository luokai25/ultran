/**
 * Prometheus repair policy.
 *
 * Classification is advisory. It never grants permissions or retries a tool.
 * A repair may only be proposed for a candidate that has not been activated,
 * and every replacement must pass the full review/test/approval lifecycle.
 */

export type RepairFailureCategory =
  | 'syntax'
  | 'schema'
  | 'dependency'
  | 'permission'
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'resource'
  | 'security'
  | 'ambiguous_side_effect'
  | 'unknown';

export type RepairAction =
  | 'regenerate_candidate'
  | 'request_dependency_approval'
  | 'manual_review'
  | 'retry_read_only_with_fresh_grant'
  | 'stop';

export interface RepairAssessment {
  category: RepairFailureCategory;
  action: RepairAction;
  retryable: boolean;
  reason: string;
}

export interface RepairContext {
  /** True only when the supervisor can prove execution did not begin. */
  executionNotStarted: boolean;
  /** Must come from a trusted tool manifest, never model inference or tool name. */
  operation: 'read_only' | 'write' | 'unknown';
  repairAttempts: number;
}

const matches = (message: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(message));

export function assessRepairFailure(message: string, context: RepairContext): RepairAssessment {
  const error = message.slice(0, 4000).toLowerCase();
  const attempts = Math.max(0, Math.floor(context.repairAttempts));

  if (matches(error, [/sandbox escape/, /policy violation/, /forbidden ast/, /security violation/, /blocked unsafe/])) {
    return { category: 'security', action: 'stop', retryable: false, reason: 'Security findings require rejection, not automatic repair.' };
  }
  if (matches(error, [/permission denied/, /not authorized/, /capability denied/, /approval required/])) {
    return { category: 'permission', action: 'stop', retryable: false, reason: 'Permission failures require an explicit permission change or human decision.' };
  }
  if (matches(error, [/unauthorized/, /invalid api key/, /authentication failed/, /401\b/, /403\b/])) {
    return { category: 'authentication', action: 'stop', retryable: false, reason: 'Authentication failures must not trigger credential guessing or replay.' };
  }
  if (matches(error, [/ambiguous commit/, /unknown write outcome/, /side effect may have occurred/])
      || (context.operation !== 'read_only' && matches(error, [/timeout/, /timed out/, /connection reset/, /socket hang up/]))) {
    return { category: 'ambiguous_side_effect', action: 'stop', retryable: false, reason: 'The write outcome may be unknown; never replay it automatically.' };
  }
  if (matches(error, [/missing package/, /module not found/, /dependency missing/, /no module named/])) {
    return { category: 'dependency', action: 'request_dependency_approval', retryable: false, reason: 'Dependency changes require review and explicit approval.' };
  }
  if (matches(error, [/syntaxerror/, /invalid syntax/, /unexpected token/, /parse error/])) {
    if (!context.executionNotStarted || attempts >= 2) {
      return { category: 'syntax', action: 'stop', retryable: false, reason: 'Syntax repair is limited to two pre-execution candidate attempts.' };
    }
    return { category: 'syntax', action: 'regenerate_candidate', retryable: true, reason: 'A pre-execution syntax defect may be repaired as a new reviewed candidate.' };
  }
  if (matches(error, [/schema validation/, /invalid input schema/, /missing required field/, /type mismatch/])) {
    if (!context.executionNotStarted || attempts >= 2) {
      return { category: 'schema', action: 'stop', retryable: false, reason: 'Schema repair is limited to two pre-execution candidate attempts.' };
    }
    return { category: 'schema', action: 'regenerate_candidate', retryable: true, reason: 'A pre-execution schema defect may be repaired as a new reviewed candidate.' };
  }
  if (matches(error, [/enotfound/, /econnrefused/, /network unavailable/, /dns lookup failed/, /connection reset/])) {
    if (context.operation === 'read_only' && attempts < 1) {
      return { category: 'network', action: 'retry_read_only_with_fresh_grant', retryable: true, reason: 'A read-only network retry may be considered once, with a fresh policy check and grant.' };
    }
    return { category: 'network', action: 'stop', retryable: false, reason: 'Network failures are not replayed unless the operation is trusted read-only and a fresh grant is issued.' };
  }
  if (matches(error, [/timeout/, /timed out/, /deadline exceeded/])) {
    return { category: 'timeout', action: 'stop', retryable: false, reason: 'Timeouts are not automatically replayed without a proven idempotency contract.' };
  }
  if (matches(error, [/out of memory/, /resource limit/, /quota exceeded/, /too many open files/])) {
    return { category: 'resource', action: 'manual_review', retryable: false, reason: 'Resource limits need a reviewed configuration change.' };
  }
  if (matches(error, [/typeerror/, /valueerror/, /keyerror/, /runtime error/, /tool failed/])) {
    return { category: 'unknown', action: 'manual_review', retryable: false, reason: 'The failure needs diagnosis; no safe retry condition was proven.' };
  }
  return { category: 'unknown', action: 'manual_review', retryable: false, reason: 'Failure could not be safely classified.' };
}

/** Candidate repair loop. It never activates a candidate or bypasses approval. */
export interface CandidateRepairAdapter<TCandidate, TReviewed> {
  generate(previousSource: string, failure: string, attempt: number): Promise<string>;
  review(source: string): Promise<TReviewed>;
  testInIsolatedWorker(reviewed: TReviewed): Promise<{ passed: boolean; report: string }>;
  buildCandidate(reviewed: TReviewed, source: string): TCandidate;
}

export interface CandidateRepairResult<TCandidate> {
  candidate?: TCandidate;
  attempts: number;
  status: 'awaiting_approval' | 'rejected';
  report: string;
}

export async function repairUnactivatedCandidate<TCandidate, TReviewed>(
  source: string,
  failure: string,
  adapter: CandidateRepairAdapter<TCandidate, TReviewed>,
): Promise<CandidateRepairResult<TCandidate>> {
  let currentSource = source;
  let lastReport = failure.slice(0, 2000);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const assessment = assessRepairFailure(lastReport, {
      executionNotStarted: true,
      operation: 'unknown',
      repairAttempts: attempt - 1,
    });
    if (!assessment.retryable || assessment.action !== 'regenerate_candidate') {
      return { attempts: attempt - 1, status: 'rejected', report: assessment.reason };
    }
    try {
      currentSource = await adapter.generate(currentSource, lastReport, attempt);
      const reviewed = await adapter.review(currentSource);
      const test = await adapter.testInIsolatedWorker(reviewed);
      if (!test.passed) {
        lastReport = failure.slice(0, 1200) + '\nPrevious candidate failed isolated regression tests: ' + test.report.slice(0, 1200);
        continue;
      }
      return {
        candidate: adapter.buildCandidate(reviewed, currentSource),
        attempts: attempt,
        status: 'awaiting_approval',
        report: 'Candidate passed source review and isolated tests. Exact-source human approval is still required.',
      };
    } catch (error) {
      lastReport = failure.slice(0, 1200) + '\nCandidate review/test error: ' + (error instanceof Error ? error.message : String(error)).slice(0, 1200);
    }
  }
  return { attempts: 2, status: 'rejected', report: 'Repair limit reached; candidate was not activated.' };
}
