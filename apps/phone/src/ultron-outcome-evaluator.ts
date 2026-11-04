/** Evidence-based evaluation of a completed ULTRON runtime turn. */
import type { LearningCause } from "./ultron-learning.js";
import type { UltronPlanStep, UltronTaskProfile, UltronValidationIssue } from "./ultron-brain.js";

export const ULTRON_OUTCOME_VERSION = "1.0.0" as const;
export type OutcomeStepStatus = "completed" | "failed" | "blocked" | "skipped" | "pending";
export type OutcomeStep = { id: string; status: OutcomeStepStatus; evidenceId?: string };
export type OutcomeTool = { id: string; ok: boolean; approvalRequired?: boolean; sideEffectVerified?: boolean };
export type OutcomeEvidence = {
  taskId: string;
  profile: Pick<UltronTaskProfile, "intent" | "requiresVerification">;
  plan: readonly UltronPlanStep[];
  steps?: readonly OutcomeStep[];
  tools?: readonly OutcomeTool[];
  validation: readonly UltronValidationIssue[];
  finalText: string;
};
export type OutcomeAssessment = {
  cause: LearningCause;
  confidence: number;
  status: "verified_success" | "partial" | "blocked" | "failed" | "unverified";
  evidenceIds: string[];
  reasons: string[];
  shouldRecord: boolean;
};
const cleanId = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,95}$/.test(value);

/**
 * Classifies only observable execution facts. Missing telemetry is unknown,
 * never silently upgraded to a reasoning error or successful completion.
 */
export function evaluateUltronOutcome(input: OutcomeEvidence): OutcomeAssessment {
  const reasons: string[] = [];
  const tools = input.tools ?? [];
  const validationErrors = input.validation.filter((issue) => issue.severity === "error");
  const validationWarnings = input.validation.filter((issue) => issue.severity === "warning");
  const failedTools = tools.filter((tool) => !tool.ok && !tool.approvalRequired);
  const blockedTools = tools.filter((tool) => !tool.ok && tool.approvalRequired);
  const steps = input.steps ?? [];
  const knownPlanIds = new Set(input.plan.map((step) => step.id));
  const validSteps = steps.filter((step) => knownPlanIds.has(step.id));
  const failedSteps = validSteps.filter((step) => step.status === "failed");
  const failedReasoningSteps = failedSteps.filter((step) => {
    const kind = input.plan.find((plan) => plan.id === step.id)?.kind;
    return kind === "understand" || kind === "reason";
  });
  const failedActionSteps = failedSteps.filter((step) => input.plan.find((plan) => plan.id === step.id)?.kind === "act");
  const failedVerificationSteps = failedSteps.filter((step) => input.plan.find((plan) => plan.id === step.id)?.kind === "verify");
  const blockedSteps = validSteps.filter((step) => step.status === "blocked");
  const pendingSteps = validSteps.filter((step) => step.status === "pending");
  const skippedRequired = validSteps.filter((step) => step.status === "skipped" && input.plan.find((plan) => plan.id === step.id)?.kind !== "deliver");

  if (!input.taskId || !cleanId(input.taskId)) reasons.push("Task correlation identifier is missing or invalid.");
  if (!input.finalText.trim()) reasons.push("No final response was produced.");
  if (failedTools.length) reasons.push(`${failedTools.length} tool execution(s) returned failure.`);
  if (blockedTools.length || blockedSteps.length) reasons.push("A required operation was blocked by an approval or permission boundary.");
  if (failedSteps.length) reasons.push(`${failedSteps.length} planned step(s) failed.`);
  if (pendingSteps.length || skippedRequired.length) reasons.push("The recorded plan contains unfinished or skipped required steps.");
  if (validationErrors.length) reasons.push("The final response failed a structural validation check.");
  if (validationWarnings.length) reasons.push("The final response has unresolved verification warnings.");

  const evidenceIds = [...new Set(validSteps.map((step) => step.evidenceId).filter((id): id is string => Boolean(id && cleanId(id))))].slice(0, 8);
  const hasExplicitStepTelemetry = steps.length > 0;
  const allReportedStepsComplete = hasExplicitStepTelemetry && validSteps.length === input.plan.length && validSteps.every((step) => step.status === "completed" && Boolean(step.evidenceId && cleanId(step.evidenceId)));

  if (blockedTools.length || blockedSteps.length) return { cause: "permission_boundary", confidence: 0.98, status: "blocked", evidenceIds, reasons, shouldRecord: true };
  if (failedTools.length) return { cause: "tool_execution", confidence: 0.98, status: "failed", evidenceIds, reasons, shouldRecord: false };
  if (failedActionSteps.length || failedTools.length) return { cause: "tool_execution", confidence: 0.96, status: "failed", evidenceIds, reasons, shouldRecord: false };
  if (failedVerificationSteps.length) return { cause: "verification_gap", confidence: 0.94, status: "unverified", evidenceIds, reasons, shouldRecord: false };
  if (failedReasoningSteps.length) return { cause: "reasoning_error", confidence: 0.86, status: "failed", evidenceIds, reasons, shouldRecord: true };
  if (failedSteps.length) return { cause: "unknown", confidence: 0.4, status: "failed", evidenceIds, reasons, shouldRecord: false };
  if (validationErrors.length || validationWarnings.length) return { cause: "verification_gap", confidence: validationErrors.length ? 0.95 : 0.78, status: "unverified", evidenceIds, reasons, shouldRecord: false };
  if (pendingSteps.length || skippedRequired.length) return { cause: "incomplete_result", confidence: 0.9, status: "partial", evidenceIds, reasons, shouldRecord: true };
  if (!input.finalText.trim()) return { cause: "incomplete_result", confidence: 0.99, status: "failed", evidenceIds, reasons, shouldRecord: false };

  // Do not infer success from a fluent answer. A high-effort task needs explicit
  // step evidence; a verified external action needs a successful tool result.
  const planVerified = allReportedStepsComplete && evidenceIds.length >= Math.min(1, input.plan.length);
  const actionVerified = input.profile.intent === "external_action" && tools.length > 0 && tools.every((tool) => tool.ok) && tools.some((tool) => tool.sideEffectVerified === true && !tool.approvalRequired);
  if (planVerified || actionVerified) {
    return { cause: "positive_strategy", confidence: planVerified ? 0.96 : 0.9, status: "verified_success", evidenceIds, reasons: ["The recorded outcome has concrete execution or step evidence and no unresolved validation issue."], shouldRecord: true };
  }
  return { cause: "unknown", confidence: 0.25, status: "unverified", evidenceIds, reasons: [...reasons, "Available telemetry does not establish either failure cause or verified completion."], shouldRecord: false };
}
