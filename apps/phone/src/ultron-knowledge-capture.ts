import {
  recordKnowledge,
  disputeKnowledge,
  type KnowledgeKind,
  type KnowledgeState,
} from "./ultron-knowledge-state";

export type KnowledgeEvidence = {
  id: string;
  text: string;
  source: "user_statement" | "user_correction" | "tool_result" | "model_inference";
  observedAt?: number;
  confidence?: number;
};

export type KnowledgeConflict = {
  candidateId: string;
  existingId: string;
  similarity: number;
  reason: "opposite_polarity" | "correction" | "near_duplicate";
  resolution: "supersede" | "dispute" | "ignore";
};

export type KnowledgeCaptureResult = {
  state: KnowledgeState;
  captured: string[];
  conflicts: KnowledgeConflict[];
  ignored: string[];
};

const clean = (value: string, limit = 280): string =>
  value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
const words = (value: string): string[] =>
  (value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word) => !new Set(["that", "this", "with", "from", "have", "will", "just", "really", "very", "about", "your", "there", "then", "than", "they", "them", "their", "been", "being", "because", "please", "also", "only"]).has(word),
  );
const NEGATION = /\b(not|never|don't|dont|doesn't|doesnt|can't|cannot|won't|wont|no longer|avoid|without|stop|غير|مش|ليس|لا|لن|لم|بدون|متبقاش|ماعدش)\b/i;
const CORRECTION = /\b(actually|correction|i meant|i mean|instead|no,|not .+ but|from now on|going forward|update that|change that)\b|(?:قصدي|أقصد|تصحيح|بدل|من الآن|بعد كده|مش .+ لكن)/i;
const DECISION = /\b(i prefer|i do not prefer|i don't prefer|i want|i need|i chose|i choose|i decided|i always|i never|from now on|going forward|must|only use|do not use|don't use|never use|keep .+ as|make sure)\b|(?:أفضل|عايز|أريد|قررت|اخترت|دائما|أبدا|من الآن|لا تستخدم|ممنوع|لازم|خلي|احرص)/i;
const PERSONAL_FACT = /\b(my name is|i am called|i use|i own|i live in|my device is|my phone is|my project is)\b|(?:اسمي|أستخدم|املك|هاتفي|جهازي|مشروعي)/i;
const SENSITIVE = /\b(password|passcode|secret key|private key|api key|token|credit card|bank account|medical diagnosis|medication|religion|political party|sexual orientation)\b|(?:كلمة المرور|مفتاح سري|بطاقة ائتمان|حساب بنكي|تشخيص طبي|دواء|ديانتي|توجهي السياسي)/i;

function polarity(value: string): boolean {
  return NEGATION.test(value);
}
function similarity(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const term of left) if (right.has(term)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}
function makeCandidate(message: string, source: KnowledgeEvidence["source"]): { kind: KnowledgeKind; claim: string; confidence: number } | null {
  const claim = clean(message);
  if (claim.length < 8 || claim.length > 280 || SENSITIVE.test(claim)) return null;
  if (DECISION.test(claim)) return { kind: "user_decision", claim, confidence: 0.98 };
  if (source === "user_correction") return { kind: "fact", claim, confidence: 0.98 };
  if (PERSONAL_FACT.test(claim)) return { kind: "fact", claim, confidence: 0.92 };
  return null;
}

/** Detects semantic overlap and polarity changes without asking a model or treating similarity as proof. */
export function detectKnowledgeConflicts(state: KnowledgeState, evidence: KnowledgeEvidence): KnowledgeConflict[] {
  const candidate = makeCandidate(evidence.text, evidence.source);
  if (!candidate) return [];
  const correction = evidence.source === "user_correction" || CORRECTION.test(evidence.text);
  return state.records
    .filter((record) => record.status === "active" && record.kind === candidate.kind)
    .map((record) => {
      const score = similarity(record.claim, candidate.claim);
      const opposite = polarity(record.claim) !== polarity(candidate.claim);
      const duplicate = score >= 0.82;
      const conflict = opposite && score >= 0.38;
      const correctionMatch = correction && score >= 0.38;
      const reason = conflict ? "opposite_polarity" : correctionMatch ? "correction" : "near_duplicate";
      const resolution = conflict ? "dispute" : correctionMatch ? "supersede" : duplicate ? "ignore" : "ignore";
      return { candidateId: evidence.id, existingId: record.id, similarity: Number(score.toFixed(3)), reason, resolution } satisfies KnowledgeConflict;
    })
    .filter((item) => item.similarity >= 0.38)
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Captures only explicit, low-ambiguity user decisions and first-person facts.
 * Arbitrary assistant prose, imported documents and model guesses are never auto-promoted.
 */
export function captureExplicitKnowledge(
  state: KnowledgeState,
  evidence: KnowledgeEvidence,
  now = evidence.observedAt ?? Date.now(),
): KnowledgeCaptureResult {
  const candidate = makeCandidate(evidence.text, evidence.source);
  if (!candidate) return { state, captured: [], conflicts: [], ignored: ["No safe explicit fact or decision was detected."] };

  const conflicts = detectKnowledgeConflicts(state, evidence);
  let next = state;
  const supersedes: string[] = [];
  const disputed: string[] = [];
  for (const conflict of conflicts) {
    if (conflict.resolution === "supersede") supersedes.push(conflict.existingId);
    if (conflict.resolution === "dispute") disputed.push(conflict.existingId);
  }
  for (const id of disputed) next = disputeKnowledge(next, id, "A newer explicit user statement conflicts with this record; clarification is required.", now);

  const isCorrection = evidence.source === "user_correction" || CORRECTION.test(evidence.text);
  if (conflicts.some((item) => item.reason === "near_duplicate")) {
    return { state, captured: [], conflicts, ignored: ["A materially equivalent active record already exists."] };
  }
  const id = clean(evidence.id, 100) || `knowledge-${now.toString(36)}`;
  next = recordKnowledge(next, {
    id,
    kind: candidate.kind,
    claim: candidate.claim,
    source: evidence.source,
    confidence: candidate.confidence,
    evidenceRefs: [id],
    supersedes,
  }, now);
  const captured = next.revision > state.revision ? [id] : [];
  return {
    state: next,
    captured,
    conflicts,
    ignored: captured.length ? [] : [isCorrection ? "Correction matched an existing record or could not be applied." : "The statement was already recorded."],
  };
}

/** Tool evidence is retained as evidence metadata only; it cannot create a user preference. */
export function validateKnowledgeEvidence(value: unknown): KnowledgeEvidence | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<KnowledgeEvidence>;
  if (typeof item.id !== "string" || typeof item.text !== "string") return null;
  if (!["user_statement", "user_correction", "tool_result", "model_inference"].includes(item.source ?? "")) return null;
  const text = clean(item.text, 280);
  if (!text || SENSITIVE.test(text)) return null;
  return {
    id: clean(item.id, 100),
    text,
    source: item.source as KnowledgeEvidence["source"],
    ...(Number.isFinite(item.observedAt) ? { observedAt: item.observedAt } : {}),
    ...(Number.isFinite(item.confidence) ? { confidence: Math.max(0, Math.min(1, item.confidence!)) } : {}),
  };
}
