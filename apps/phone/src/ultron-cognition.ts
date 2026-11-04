/**
 * ULTRON Cognitive Architecture
 *
 * A provider-independent control layer for allocating reasoning effort,
 * structuring problem solving, evaluating evidence, comparing options and
 * deciding whether a task is genuinely complete. It guides the imported
 * language model; it does not pretend to replace its learned capabilities.
 */

export const ULTRON_COGNITION_VERSION = "1.0.0" as const;

export type CognitiveMode = "direct" | "deliberate" | "investigative" | "critical";
export type CognitiveSignal =
  | "ambiguity"
  | "multiple_objectives"
  | "dependencies"
  | "external_facts"
  | "time_sensitive"
  | "high_impact"
  | "continuation"
  | "correction"
  | "attachments"
  | "uncertainty";
export type CognitiveProfile = {
  mode: CognitiveMode;
  signals: CognitiveSignal[];
  reasoningPasses: number;
  needsEvidence: boolean;
  needsCounterexampleCheck: boolean;
  needsCompletionAudit: boolean;
  stopWhen: string[];
};
export type EvidenceKind = "user_statement" | "project_file" | "tool_result" | "official_source" | "secondary_source" | "model_inference" | "memory";
export type VerifiedReasoningOutcome = {
  taskClass: string;
  id?: string;
  correlationId?: string;
  status: "verified_success" | "verified_failure";
  verified: boolean;
  confidence: number;
  at: number;
};
export type AdaptiveReasoningDecision = {
  profile: CognitiveProfile;
  sampleCount: number;
  failureCount: number;
  successCount: number;
  adjustment: "baseline" | "escalated" | "recovered";
  reason: string;
};

/**
 * Calibrates effort from independently verified outcomes only. Model confidence,
 * fluent answers, user silence and unverified tool starts are deliberately ignored.
 * Adaptation can restore the task's baseline, but never downgrade it.
 */
export function calibrateReasoningDepth(
  baseline: CognitiveProfile,
  history: readonly VerifiedReasoningOutcome[],
  taskClass: string,
  now = Date.now(),
): AdaptiveReasoningDecision {
  const cutoff = now - 90 * 86_400_000;
  const independent = new Map<string, VerifiedReasoningOutcome>();
  for (const item of history) {
    if (item.taskClass !== taskClass || item.verified !== true
      || (item.status !== "verified_success" && item.status !== "verified_failure")
      || !Number.isFinite(item.at) || item.at < cutoff || item.at > now
      || !Number.isFinite(item.confidence) || item.confidence < 0.75) continue;
    const key = item.correlationId || item.id || ("outcome-at-" + item.at);
    const previous = independent.get(key);
    if (!previous || item.at > previous.at) independent.set(key, item);
  }
  const samples = [...independent.values()].sort((a, b) => b.at - a.at).slice(0, 12);
  const failureCount = samples.filter((item) => item.status === "verified_failure").length;
  const successCount = samples.length - failureCount;
  const failureRate = samples.length ? failureCount / samples.length : 0;
  let adjustment: AdaptiveReasoningDecision["adjustment"] = "baseline";
  let extraPasses = 0;
  let reason = "No sufficiently strong outcome pattern; retain the task's original reasoning budget.";

  if (samples.length >= 3 && failureCount >= 2 && failureRate >= 0.3) {
    extraPasses = failureRate >= 0.5 ? 2 : 1;
    adjustment = "escalated";
    reason = "Verified failures in " + failureCount + " of " + samples.length + " recent comparable tasks justify additional checking.";
  } else if (samples.length >= 5 && successCount >= 5 && failureCount === 0) {
    adjustment = "recovered";
    reason = "A sustained verified-success record clears any learned escalation; baseline effort is preserved.";
  }

  const modeRank: Record<CognitiveMode, number> = { direct: 0, deliberate: 1, investigative: 1, critical: 2 };
  const currentRank = modeRank[baseline.mode];
  const targetRank = Math.min(2, currentRank + (extraPasses > 0 ? 1 : 0));
  const mode: CognitiveMode = targetRank >= 2 ? "critical" : targetRank === 1
    ? (baseline.mode === "investigative" ? "investigative" : "deliberate") : baseline.mode;
  const profile: CognitiveProfile = {
    ...baseline,
    mode,
    reasoningPasses: Math.min(4, baseline.reasoningPasses + extraPasses),
    needsEvidence: baseline.needsEvidence || extraPasses > 0,
    needsCounterexampleCheck: baseline.needsCounterexampleCheck || extraPasses > 0,
    needsCompletionAudit: baseline.needsCompletionAudit || extraPasses > 0,
    signals: extraPasses > 0 ? unique([...baseline.signals, "uncertainty"]) : baseline.signals,
  };
  return { profile, sampleCount: samples.length, failureCount, successCount, adjustment, reason };
}

export type CognitiveEvidence = {
  id: string;
  claim: string;
  kind: EvidenceKind;
  source: string;
  observedAt?: number;
  confidence?: number;
  directlySupports?: boolean;
};
export type EvidenceAssessment = {
  evidence: CognitiveEvidence;
  reliability: number;
  freshness: number;
  status: "strong" | "supporting" | "weak" | "stale";
  limitations: string[];
};
export type DecisionCriterion = { id: string; weight: number; direction: "maximize" | "minimize" };
export type DecisionOption = { id: string; label: string; scores: Record<string, number>; risks?: string[]; assumptions?: string[] };
export type RankedDecision = { option: DecisionOption; utility: number; missingCriteria: string[]; riskCount: number };
export type CompletionState = {
  required: number;
  completed: number;
  verified: number;
  blocked: number;
  failed: number;
  unresolvedRisks: number;
  deliverableExists: boolean;
};
export type CompletionDecision = { complete: boolean; stop: boolean; reasons: string[]; next: "continue" | "verify" | "deliver" | "report_blocker" };

const WORDS = (text: string): string[] => (text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Detects structural properties of a task without spending an inference call. */
export function analyzeCognitiveProfile(
  task: string,
  options: { continuation?: boolean; hasAttachments?: boolean; priorCorrection?: boolean } = {},
): CognitiveProfile {
  const text = task.trim();
  const signals: CognitiveSignal[] = [];
  if (/\b(it|that|there|the other one|the usual|same as before)\b/i.test(text) && text.length < 120) signals.push("ambiguity");
  if (/\b(and|also|plus|both|all of|compare|versus|vs\.)\b|،| و /i.test(text)) signals.push("multiple_objectives");
  if (/\b(after|before|once|when|depend|integrat|workflow|end.to.end|step.by.step)\b/i.test(text)) signals.push("dependencies");
  if (/\b(latest|current|today|now|price|version|release|status|available|open now)\b/i.test(text)) signals.push("external_facts");
  if (/\b(today|tonight|tomorrow|deadline|urgent|this week|right now)\b/i.test(text)) signals.push("time_sensitive");
  if (/\b(delete|send|publish|deploy|pay|purchase|transfer|credential|medical|legal|financial|production|private data)\b/i.test(text)) signals.push("high_impact");
  if (options.continuation) signals.push("continuation");
  if (options.priorCorrection) signals.push("correction");
  if (options.hasAttachments) signals.push("attachments");
  if (/\b(maybe|perhaps|uncertain|not sure|unknown|estimate|guess|assume)\b/i.test(text)) signals.push("uncertainty");

  const severe = signals.includes("high_impact");
  const complex = signals.some((signal) => ["multiple_objectives", "dependencies", "attachments", "correction"].includes(signal));
  const investigative = signals.includes("external_facts") || signals.includes("uncertainty");
  const mode: CognitiveMode = severe ? "critical" : complex ? "deliberate" : investigative ? "investigative" : "direct";
  const reasoningPasses = mode === "direct" ? 1 : 2;
  return {
    mode,
    signals: unique(signals),
    reasoningPasses,
    needsEvidence: investigative || severe,
    needsCounterexampleCheck: complex || investigative || severe,
    needsCompletionAudit: complex || severe || options.continuation === true,
    stopWhen: [
      "The requested outcome and active constraints are satisfied.",
      "Every consequential claim is supported or clearly labelled uncertain.",
      "No unresolved blocker is being hidden as completed work.",
    ],
  };
}

/**
 * Converts the cognitive profile into a short operational protocol. It asks
 * the model to perform internal reasoning, never to reveal private scratchwork.
 */
export function buildCognitiveInstructions(profile: CognitiveProfile): string {
  const lines = [
    `COGNITIVE MODE: ${profile.mode}; bounded reasoning passes=${profile.reasoningPasses}.`,
    "Maintain a compact internal state: goal, hard constraints, known facts, assumptions, open questions, decisions and completed work.",
    "Solve the actual objective rather than matching isolated keywords. Separate independent subproblems, then respect their dependencies.",
    "Treat current user instructions as authoritative for the task; use prior context as supporting evidence, not as a reason to ignore corrections.",
  ];
  if (profile.needsEvidence) lines.push("EVIDENCE DISCIPLINE: identify which claims need current or primary evidence; distinguish direct observations, sourced facts, inference and unknowns. Never upgrade an inference into a fact.");
  if (profile.needsCounterexampleCheck) lines.push("ADVERSARIAL CHECK: test the leading answer against at least one plausible alternative, a failure case, and the user's explicit constraints. Change course when the evidence warrants it.");
  if (profile.signals.includes("multiple_objectives")) lines.push("OBJECTIVE MANAGEMENT: preserve each requested outcome; do not silently optimize one objective by sacrificing another.");
  if (profile.signals.includes("dependencies")) lines.push("DEPENDENCY MANAGEMENT: complete prerequisites first; do not report downstream work as complete while a prerequisite remains unresolved.");
  if (profile.signals.includes("high_impact")) lines.push("IMPACT CONTROL: identify reversibility and blast radius. Require the applicable explicit approval before external, destructive, financial, or sensitive actions.");
  if (profile.signals.includes("continuation")) lines.push("CONTINUITY: resume from the last verified state, retain earlier constraints, and avoid repeating completed work unless a check reveals it is defective.");
  if (profile.signals.includes("correction")) lines.push("CORRECTION HANDLING: treat the latest explicit correction as a state update; inspect dependent decisions for stale assumptions.");
  if (profile.needsCompletionAudit) lines.push("COMPLETION AUDIT: compare the result against every requested outcome; verify artifacts and tests from actual outputs, not intention.");
  lines.push(`STOPPING CONDITIONS: ${profile.stopWhen.join(" ")}`);
  lines.push("Do not expose hidden chain-of-thought. Give concise conclusions, relevant evidence, decisions and checkable rationale.");
  return ["ULTRON COGNITIVE CONTROL", ...lines].join("\n");
}

/** Assigns an evidence score while keeping its provenance and limitations visible. */
export function assessCognitiveEvidence(item: CognitiveEvidence, now = Date.now()): EvidenceAssessment {
  const base: Record<EvidenceKind, number> = {
    user_statement: 0.88,
    project_file: 0.9,
    tool_result: 0.94,
    official_source: 0.93,
    secondary_source: 0.72,
    model_inference: 0.35,
    memory: 0.56,
  };
  const reliability = clamp((item.confidence ?? base[item.kind]) * (item.directlySupports === false ? 0.65 : 1), 0, 1);
  const ageDays = item.observedAt ? Math.max(0, (now - item.observedAt) / 86_400_000) : 0;
  const freshness = item.kind === "user_statement" || item.kind === "project_file" ? clamp(1 - ageDays / 730, 0.25, 1) : clamp(1 - ageDays / 180, 0.1, 1);
  const limitations: string[] = [];
  if (!item.source.trim()) limitations.push("Source is not identified.");
  if (item.kind === "model_inference") limitations.push("This is a reasoned inference, not an independently verified observation.");
  if (item.kind === "memory") limitations.push("Memory may be stale or incomplete; check against the current request.");
  if (item.directlySupports === false) limitations.push("The evidence is related but does not directly establish the claim.");
  if (ageDays > 180 && ["tool_result", "official_source", "secondary_source"].includes(item.kind)) limitations.push("The evidence may no longer describe the current state.");
  const combined = reliability * 0.72 + freshness * 0.28;
  const status: EvidenceAssessment["status"] = ageDays > 730 ? "stale" : combined >= 0.82 ? "strong" : combined >= 0.62 ? "supporting" : "weak";
  return { evidence: item, reliability, freshness, status, limitations };
}

/** Ranks options against explicit weighted criteria; missing data is not a zero-cost win. */
export function rankDecisionOptions(criteria: readonly DecisionCriterion[], options: readonly DecisionOption[]): RankedDecision[] {
  const totalWeight = criteria.reduce((sum, item) => sum + Math.max(0, item.weight), 0) || 1;
  return options.map((option) => {
    let weighted = 0;
    let knownWeight = 0;
    const missingCriteria: string[] = [];
    for (const criterion of criteria) {
      const score = option.scores[criterion.id];
      if (typeof score !== "number" || !Number.isFinite(score)) {
        missingCriteria.push(criterion.id);
        continue;
      }
      const normalized = clamp(score, 0, 100);
      weighted += (criterion.direction === "maximize" ? normalized : 100 - normalized) * Math.max(0, criterion.weight);
      knownWeight += Math.max(0, criterion.weight);
    }
    const coverage = knownWeight / totalWeight;
    const utility = knownWeight ? (weighted / knownWeight) * coverage : 0;
    return { option, utility, missingCriteria, riskCount: option.risks?.length ?? 0 };
  }).sort((a, b) => b.utility - a.utility || a.riskCount - b.riskCount);
}

/** Contradictions are surfaced, never silently resolved by whichever fact is newer. */
export function detectCognitiveConflicts<T extends { key: string; value: string; source: string; priority: number }>(facts: readonly T[]): Array<{ key: string; alternatives: T[] }> {
  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    const list = groups.get(fact.key) ?? [];
    list.push(fact);
    groups.set(fact.key, list);
  }
  return [...groups.entries()].flatMap(([key, items]) => {
    const alternatives = items.filter((item, index) => items.findIndex((other) => other.value === item.value) === index);
    return alternatives.length > 1 ? [{ key, alternatives: alternatives.sort((a, b) => b.priority - a.priority) }] : [];
  });
}

/** Prevents premature completion and also prevents endless agent loops. */
export function evaluateCognitiveCompletion(state: CompletionState): CompletionDecision {
  const reasons: string[] = [];
  const validRequired = Math.max(0, state.required);
  const validCompleted = clamp(state.completed, 0, validRequired);
  const allStepsDone = validCompleted === validRequired && state.blocked === 0 && state.failed === 0;
  if (!state.deliverableExists) reasons.push("The requested deliverable does not exist yet.");
  if (!allStepsDone) reasons.push("One or more required steps remain pending, blocked, or failed.");
  if (state.verified < validCompleted) reasons.push("Completed work has not all been verified.");
  if (state.unresolvedRisks > 0) reasons.push("Unresolved risks still need to be addressed or disclosed.");
  const complete = state.deliverableExists && allStepsDone && state.verified >= validCompleted && state.unresolvedRisks === 0;
  if (complete) return { complete: true, stop: true, reasons: ["All required work exists, is verified, and has no undisclosed unresolved risk."], next: "deliver" };
  if (state.blocked > 0) return { complete: false, stop: true, reasons, next: "report_blocker" };
  if (state.completed > state.verified) return { complete: false, stop: false, reasons, next: "verify" };
  return { complete: false, stop: false, reasons, next: "continue" };
}

/** A compact diagnostic snapshot that is safe to persist without user content. */
export function summarizeCognitiveProfile(profile: CognitiveProfile): string {
  return `${profile.mode}|passes:${profile.reasoningPasses}|signals:${profile.signals.join(",") || "none"}|evidence:${profile.needsEvidence}|audit:${profile.needsCompletionAudit}`;
}
