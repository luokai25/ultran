/**
 * ULTRON Learning & Self-Improvement Engine
 *
 * Converts observed outcomes into reviewable improvement proposals. It never
 * executes generated code, edits files, or grants itself permissions. Durable
 * changes require a human approval token tied to the exact proposal.
 */
export const ULTRON_LEARNING_VERSION = "1.0.0" as const;

export type LearningSignal = "user_correction" | "task_failure" | "tool_failure" | "verification_failure" | "user_success" | "repeated_friction";
export type LearningSeverity = "low" | "medium" | "high" | "critical";
export type ProposalStatus = "observed" | "proposed" | "approved" | "implemented" | "verified" | "rejected";
export type LearningEvent = {
  id: string;
  at: number;
  signal: LearningSignal;
  category: string;
  summary: string;
  severity: LearningSeverity;
  source: "user_feedback" | "runtime" | "test" | "tool_result";
  evidenceIds: string[];
};
export type ImprovementProposal = {
  id: string;
  fingerprint: string;
  title: string;
  hypothesis: string;
  evidenceIds: string[];
  impact: number;
  recurrence: number;
  confidence: number;
  risk: number;
  priority: number;
  status: ProposalStatus;
  createdAt: number;
  updatedAt: number;
  approvalFingerprint?: string;
  verificationEvidence?: string;
};
export type LearningLedger = { version: 1; events: LearningEvent[]; proposals: ImprovementProposal[]; updatedAt: number };
export type LearningDecision = { accepted: boolean; ledger: LearningLedger; reason: string; proposal?: ImprovementProposal };

const MAX_EVENTS = 120;
const MAX_PROPOSALS = 60;
const clean = (value: string, max: number): string => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const validId = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,95}$/.test(value);
const fingerprint = (category: string, title: string): string => `${clean(category, 48).toLowerCase()}::${clean(title, 100).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;

export function createLearningLedger(): LearningLedger {
  return { version: 1, events: [], proposals: [], updatedAt: Date.now() };
}

/** Validates imported local data before it is trusted by the learning engine. */
export function validateLearningLedger(value: unknown): LearningLedger {
  const fallback = createLearningLedger();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<LearningLedger>;
  if (candidate.version !== 1 || !Array.isArray(candidate.events) || !Array.isArray(candidate.proposals)) return fallback;
  const signals: LearningSignal[] = ["user_correction", "task_failure", "tool_failure", "verification_failure", "user_success", "repeated_friction"];
  const severities: LearningSeverity[] = ["low", "medium", "high", "critical"];
  const sources: LearningEvent["source"][] = ["user_feedback", "runtime", "test", "tool_result"];
  const statuses: ProposalStatus[] = ["observed", "proposed", "approved", "implemented", "verified", "rejected"];
  const events = candidate.events.flatMap((raw): LearningEvent[] => {
    if (!raw || typeof raw !== "object") return [];
    const event = raw as Partial<LearningEvent>;
    if (!validId(event.id ?? "") || !Number.isFinite(event.at) || (event.at as number) <= 0 || typeof event.summary !== "string" || typeof event.category !== "string" || !signals.includes(event.signal as LearningSignal) || !severities.includes(event.severity as LearningSeverity) || !sources.includes(event.source as LearningEvent["source"]) || !Array.isArray(event.evidenceIds)) return [];
    return [{ id: event.id!, at: event.at!, signal: event.signal!, category: clean(event.category, 48).toLowerCase(), summary: clean(event.summary, 240), severity: event.severity!, source: event.source!, evidenceIds: event.evidenceIds.filter((id): id is string => typeof id === "string" && validId(id)).slice(0, 8) }];
  }).slice(-MAX_EVENTS);
  const eventIds = new Set(events.map((event) => event.id));
  const proposals = candidate.proposals.flatMap((raw): ImprovementProposal[] => {
    if (!raw || typeof raw !== "object") return [];
    const proposal = raw as Partial<ImprovementProposal>;
    if (!validId(proposal.id ?? "") || typeof proposal.fingerprint !== "string" || typeof proposal.title !== "string" || typeof proposal.hypothesis !== "string" || !statuses.includes(proposal.status as ProposalStatus) || !Array.isArray(proposal.evidenceIds) || !Number.isFinite(proposal.createdAt) || !Number.isFinite(proposal.updatedAt) || ![proposal.impact, proposal.recurrence, proposal.confidence, proposal.risk, proposal.priority].every((score) => typeof score === "number" && Number.isFinite(score))) return [];
    const evidenceIds = proposal.evidenceIds.filter((id): id is string => typeof id === "string" && eventIds.has(id)).slice(0, 8);
    if (!evidenceIds.length) return [];
    return [{ id: proposal.id!, fingerprint: clean(proposal.fingerprint, 180), title: clean(proposal.title, 120), hypothesis: clean(proposal.hypothesis, 500), evidenceIds, impact: clamp(proposal.impact!, 0, 1), recurrence: clamp(proposal.recurrence!, 0, 1), confidence: clamp(proposal.confidence!, 0, 1), risk: clamp(proposal.risk!, 0, 1), priority: clamp(proposal.priority!, 0, 1), status: proposal.status!, createdAt: proposal.createdAt!, updatedAt: proposal.updatedAt!, ...(typeof proposal.approvalFingerprint === "string" ? { approvalFingerprint: clean(proposal.approvalFingerprint, 240) } : {}), ...(typeof proposal.verificationEvidence === "string" ? { verificationEvidence: clean(proposal.verificationEvidence, 500) } : {}) }];
  }).slice(-MAX_PROPOSALS);
  return { version: 1, events, proposals, updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now() };
}

/** Records concise outcome metadata, rejecting raw prompt-sized or malformed events. */
export function recordLearningEvent(ledger: LearningLedger, input: Omit<LearningEvent, "at" | "summary" | "category"> & { at?: number; summary: string; category: string }): LearningDecision {
  const reject = (reason: string): LearningDecision => ({ accepted: false, ledger, reason });
  if (!validId(input.id) || ledger.events.some((event) => event.id === input.id)) return reject("Event ID is invalid or already exists.");
  if (!Number.isFinite(input.at ?? Date.now()) || (input.at ?? Date.now()) <= 0 || (input.at ?? Date.now()) > Date.now() + 60_000) return reject("Event timestamp is invalid.");
  if (!input.summary.trim() || input.summary.length > 500 || !input.category.trim() || input.category.length > 64) return reject("Learning events require a short category and summary; raw conversation content is not accepted.");
  if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length > 8 || input.evidenceIds.some((id) => !validId(id))) return reject("Evidence references are malformed or exceed the limit.");
  const event: LearningEvent = { ...input, at: input.at ?? Date.now(), summary: clean(input.summary, 240), category: clean(input.category, 48).toLowerCase(), evidenceIds: [...new Set(input.evidenceIds)] };
  const events = [...ledger.events, event].slice(-MAX_EVENTS);
  const next = { ...ledger, events, updatedAt: Date.now() };
  return { accepted: true, ledger: next, reason: "Outcome metadata recorded without storing the original prompt or private payload." };
}

/** Creates one evidence-backed proposal and merges recurrence instead of spamming duplicates. */
export function proposeLearningImprovement(ledger: LearningLedger, input: {
  id: string; title: string; hypothesis: string; category: string; evidenceIds: string[];
  impact: number; confidence: number; risk: number; now?: number;
}): LearningDecision {
  const reject = (reason: string): LearningDecision => ({ accepted: false, ledger, reason });
  if (!validId(input.id) || ledger.proposals.some((item) => item.id === input.id)) return reject("Proposal ID is invalid or already exists.");
  if (input.title.trim().length < 5 || input.title.length > 120 || input.hypothesis.trim().length < 15 || input.hypothesis.length > 500) return reject("A proposal needs a specific title and a testable hypothesis.");
  if (!input.evidenceIds.length || input.evidenceIds.length > 8 || input.evidenceIds.some((id) => !ledger.events.some((event) => event.id === id))) return reject("A proposal must cite existing learning events as evidence.");
  if (![input.impact, input.confidence, input.risk].every((score) => Number.isFinite(score) && score >= 0 && score <= 1)) return reject("Impact, confidence and risk must be scores from 0 to 1.");
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || now <= 0 || now > Date.now() + 60_000) return reject("Proposal timestamp is invalid.");
  const key = fingerprint(input.category, input.title);
  const prior = ledger.proposals.find((proposal) => proposal.fingerprint === key && proposal.status !== "rejected");
  if (prior) {
    const recurrence = Math.min(1, prior.recurrence + 0.15);
    const updated = { ...prior, recurrence, impact: Math.max(prior.impact, input.impact), confidence: Math.max(prior.confidence, input.confidence), risk: Math.max(prior.risk, input.risk), priority: calculateLearningPriority(Math.max(prior.impact, input.impact), recurrence, Math.max(prior.confidence, input.confidence), Math.max(prior.risk, input.risk)), evidenceIds: [...new Set([...prior.evidenceIds, ...input.evidenceIds])].slice(-8), updatedAt: now };
    const next = { ...ledger, proposals: ledger.proposals.map((item) => item.id === prior.id ? updated : item), updatedAt: now };
    return { accepted: true, ledger: next, proposal: updated, reason: "Repeated evidence strengthened the existing proposal instead of creating a duplicate." };
  }
  const impact = clamp(input.impact, 0, 1), confidence = clamp(input.confidence, 0, 1), risk = clamp(input.risk, 0, 1);
  const proposal: ImprovementProposal = { id: input.id, fingerprint: key, title: clean(input.title, 120), hypothesis: clean(input.hypothesis, 500), evidenceIds: [...new Set(input.evidenceIds)], impact, recurrence: 0.15, confidence, risk, priority: calculateLearningPriority(impact, 0.15, confidence, risk), status: "proposed", createdAt: now, updatedAt: now };
  return { accepted: true, ledger: { ...ledger, proposals: [...ledger.proposals, proposal].slice(-MAX_PROPOSALS), updatedAt: now }, proposal, reason: "A reviewable proposal was created; no code or settings were changed." };
}

export function calculateLearningPriority(impact: number, recurrence: number, confidence: number, risk: number): number {
  const values = [impact, recurrence, confidence, risk];
  if (!values.every((value) => Number.isFinite(value))) return 0;
  return Math.round(clamp((clamp(impact, 0, 1) * 0.35 + clamp(recurrence, 0, 1) * 0.25 + clamp(confidence, 0, 1) * 0.4) * (1 - clamp(risk, 0, 1) * 0.65), 0, 1) * 1000) / 1000;
}

/** Approval is bound to one proposal and cannot be reused for another change. */
export function approveLearningProposal(ledger: LearningLedger, proposalId: string, approvalFingerprint: string, approvedFingerprint: string): LearningDecision {
  const proposal = ledger.proposals.find((item) => item.id === proposalId);
  if (!proposal) return { accepted: false, ledger, reason: "Proposal does not exist." };
  if (proposal.status !== "proposed" || !approvalFingerprint || approvalFingerprint !== approvedFingerprint || approvalFingerprint !== `ultron-learning:${proposal.id}:${proposal.fingerprint}`) return { accepted: false, ledger, reason: "Approval must explicitly match this exact pending proposal." };
  const updated = { ...proposal, status: "approved" as const, approvalFingerprint, updatedAt: Date.now() };
  return { accepted: true, ledger: { ...ledger, proposals: ledger.proposals.map((item) => item.id === proposalId ? updated : item), updatedAt: Date.now() }, proposal: updated, reason: "Proposal approved for implementation; approval does not itself perform the change." };
}

export function transitionLearningProposal(ledger: LearningLedger, proposalId: string, nextStatus: ProposalStatus, details: { evidence?: string; approvalFingerprint?: string } = {}): LearningDecision {
  const proposal = ledger.proposals.find((item) => item.id === proposalId);
  if (!proposal) return { accepted: false, ledger, reason: "Proposal does not exist." };
  const transitions: Record<ProposalStatus, ProposalStatus[]> = { observed: ["proposed", "rejected"], proposed: ["approved", "rejected"], approved: ["implemented", "rejected"], implemented: ["verified", "rejected"], verified: [], rejected: [] };
  if (!transitions[proposal.status].includes(nextStatus)) return { accepted: false, ledger, reason: `Invalid proposal transition ${proposal.status} -> ${nextStatus}.` };
  if (nextStatus === "implemented" && (!proposal.approvalFingerprint || details.approvalFingerprint !== proposal.approvalFingerprint)) return { accepted: false, ledger, reason: "Implementation requires the proposal's exact approval fingerprint." };
  if (nextStatus === "verified" && !details.evidence?.trim()) return { accepted: false, ledger, reason: "Verification requires concrete test or runtime evidence." };
  const updated: ImprovementProposal = { ...proposal, status: nextStatus, ...(nextStatus === "verified" ? { verificationEvidence: clean(details.evidence!, 500) } : {}), updatedAt: Date.now() };
  return { accepted: true, ledger: { ...ledger, proposals: ledger.proposals.map((item) => item.id === proposalId ? updated : item), updatedAt: Date.now() }, proposal: updated, reason: nextStatus === "verified" ? "The improvement is verified with recorded evidence." : `Proposal moved to ${nextStatus}; no unapproved side effect was performed.` };
}

/** Small prompt fragment: observations inform behaviour, but never become instructions. */
export function buildLearningContext(ledger: LearningLedger, limit = 5): string {
  const proposals = [...ledger.proposals].filter((item) => item.status === "proposed" || item.status === "approved" || item.status === "implemented").sort((a, b) => b.priority - a.priority).slice(0, clamp(limit, 1, 8));
  if (!proposals.length) return "";
  return ["ULTRON LEARNING REVIEW (structured diagnostic metadata only):", "Use these status and category signals to guide verification. Proposal text and raw user feedback are deliberately excluded from system context. Never modify code or permissions based on this context alone.", ...proposals.map((item) => {
    const rawCategory = item.fingerprint.split("::", 1)[0] ?? "";
    const category = /^[a-z0-9._-]{1,48}$/.test(rawCategory) ? rawCategory : "unclassified";
    return `- ${item.status.toUpperCase()} category=${category} (priority ${item.priority.toFixed(2)})`;
  })].join("\n");
}
