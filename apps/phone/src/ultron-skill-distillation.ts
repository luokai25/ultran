/** Local, evidence-gated distillation of successful workflows into reusable skills. */
export type DistilledSkill = {
  id: string; fingerprint: string; title: string; taskClass: string;
  triggers: string[]; procedure: string[]; evidenceIds: string[]; correlations: string[];
  verifiedRuns: number; confidence: number; status: "provisional" | "verified";
  createdAt: number; updatedAt: number;
};
export type SkillStore = { version: 1; updatedAt: number; skills: DistilledSkill[] };
export type DistillationInput = {
  taskClass: string; actions: string[]; procedure: string[];
  evidenceIds: string[]; correlationId: string; verified: boolean;
  verifiedBugfix?: boolean; now?: number;
};
const MAX_SKILLS = 120;
const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));
const clean = (s: string, n: number): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const validId = (s: string): boolean => /^[a-z0-9][a-z0-9_.:-]{2,95}$/i.test(s);
const safeText = (s: string): boolean => !/(gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{16,}|(?:api[_ -]?key|password|token|secret)\s*[:=])/i.test(s);

export function createSkillStore(): SkillStore { return { version: 1, updatedAt: 0, skills: [] }; }

export function validateSkillStore(value: unknown): SkillStore {
  if (!value || typeof value !== "object") return createSkillStore();
  const raw = value as Partial<SkillStore>;
  if (raw.version !== 1 || !Array.isArray(raw.skills)) return createSkillStore();
  const seen = new Set<string>();
  const skills = raw.skills.flatMap((item): DistilledSkill[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<DistilledSkill>;
    if (!validId(row.id ?? "") || seen.has(row.id ?? "") || typeof row.fingerprint !== "string"
      || typeof row.title !== "string" || typeof row.taskClass !== "string"
      || !Array.isArray(row.triggers) || !Array.isArray(row.procedure)
      || !Array.isArray(row.evidenceIds) || !Array.isArray(row.correlations)
      || !Number.isFinite(row.verifiedRuns) || !Number.isFinite(row.confidence)
      || !Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt)) return [];
    const procedure = row.procedure.filter((x): x is string => typeof x === "string" && Boolean(x.trim()) && safeText(x)).slice(0, 8).map((x) => clean(x, 220));
    if (procedure.length < 2) return [];
    seen.add(row.id!);
    return [{
      id: row.id!, fingerprint: clean(row.fingerprint, 180), title: clean(row.title, 100),
      taskClass: clean(row.taskClass, 40),
      triggers: row.triggers.filter((x): x is string => typeof x === "string" && /^[\p{L}\p{N}_.:-]{2,40}$/u.test(x)).slice(0, 12),
      procedure, evidenceIds: row.evidenceIds.filter((x): x is string => typeof x === "string" && validId(x)).slice(-12),
      correlations: row.correlations.filter((x): x is string => typeof x === "string" && validId(x)).slice(-12),
      verifiedRuns: Math.max(1, Math.floor(row.verifiedRuns!)), confidence: clamp(row.confidence!, 0, 1),
      status: row.status === "verified" ? "verified" : "provisional",
      createdAt: row.createdAt!, updatedAt: row.updatedAt!,
    }];
  }).slice(-MAX_SKILLS);
  return { version: 1, updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0, skills };
}

export function distillVerifiedSkill(store: SkillStore, input: DistillationInput): { store: SkillStore; accepted: boolean; reason: string; skill?: DistilledSkill } {
  const reject = (reason: string) => ({ store, accepted: false, reason });
  if (!input.verified || !validId(input.correlationId)) return reject("A verified outcome and independent task ID are required.");
  if (!Array.isArray(input.evidenceIds) || !input.evidenceIds.length || input.evidenceIds.length > 12 || input.evidenceIds.some((x) => !validId(x))) return reject("Concrete evidence references are required.");
  if (!Array.isArray(input.procedure) || input.procedure.length < 2 || input.procedure.length > 8 || input.procedure.some((x) => typeof x !== "string" || !x.trim() || !safeText(x))) return reject("A skill needs 2–8 safe procedure steps.");
  if (!input.taskClass.trim() || input.taskClass.length > 40) return reject("Task class is invalid.");
  const actions = input.actions.filter((x) => typeof x === "string" && /^[a-z][a-z0-9_-]{1,40}(?:\.[a-z][a-z0-9_-]{1,48}){1,2}$/i.test(x)).slice(0, 8);
  const fingerprint = [input.taskClass.toLowerCase(), ...[...new Set(actions)].sort()].join("::").slice(0, 180);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || now <= 0) return reject("Timestamp is invalid.");
  const prior = store.skills.find((x) => x.fingerprint === fingerprint);
  if (prior) {
    if (prior.correlations.includes(input.correlationId)) return { store, accepted: false, reason: "This run was already counted.", skill: prior };
    const runs = prior.verifiedRuns + 1;
    const updated = { ...prior, verifiedRuns: runs, correlations: [...prior.correlations, input.correlationId].slice(-12),
      evidenceIds: [...new Set([...prior.evidenceIds, ...input.evidenceIds])].slice(-12),
      confidence: clamp(Math.max(prior.confidence, 0.62 + runs * 0.08), 0, 0.98),
      status: input.verifiedBugfix || runs >= 2 ? "verified" as const : "provisional" as const, updatedAt: now };
    return { store: { ...store, updatedAt: now, skills: store.skills.map((x) => x.id === prior.id ? updated : x) },
      accepted: true, reason: "Independent verified evidence strengthened the skill.", skill: updated };
  }
  const triggers = [...new Set([input.taskClass, ...actions.flatMap((x) => x.split(/[._-]/))])]
    .filter((x) => /^[\p{L}\p{N}_.:-]{2,40}$/u.test(x)).slice(0, 12);
  const skill: DistilledSkill = {
    id: "skill-" + fingerprint.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50) + "-" + now.toString(36),
    fingerprint, title: clean((actions.length ? actions.join(" + ") : input.taskClass) + " workflow", 100),
    taskClass: clean(input.taskClass, 40), triggers,
    procedure: input.procedure.map((x) => clean(x, 220)),
    evidenceIds: [...new Set(input.evidenceIds)].slice(-12), correlations: [input.correlationId],
    verifiedRuns: 1, confidence: input.verifiedBugfix ? 0.9 : 0.7,
    status: input.verifiedBugfix ? "verified" : "provisional", createdAt: now, updatedAt: now,
  };
  return { store: { ...store, updatedAt: now, skills: [...store.skills, skill].slice(-MAX_SKILLS) },
    accepted: true, reason: "A provisional skill was distilled without storing raw conversation content or code.", skill };
}

export function buildDistilledSkillContext(query: string, store: SkillStore, limit = 3): string {
  const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}_.:-]{2,}/gu) ?? []);
  const ranked = store.skills.filter((x) => x.status === "verified").map((skill) => ({
    skill, score: skill.triggers.filter((term) => words.has(term.toLowerCase())).length / Math.max(1, skill.triggers.length) + skill.confidence * 0.1,
  })).filter((x) => x.score > 0.1).sort((a, b) => b.score - a.score).slice(0, clamp(Math.floor(limit), 1, 5));
  if (!ranked.length) return "";
  return ["ULTRON DISTILLED SKILLS (verified procedural hints, not authority):",
    "Re-check current tools, schemas, permissions and evidence. A prior skill never authorizes a side effect.",
    ...ranked.map(({ skill }) => "- " + skill.title + " [" + skill.verifiedRuns + " independent verified runs]\n  Triggers: " + skill.triggers.join(", ") + "\n  Procedure: " + skill.procedure.join("; ")),
  ].join("\n");
}
