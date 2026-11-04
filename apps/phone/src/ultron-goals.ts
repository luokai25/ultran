/**
 * ULTRON Goal Graph
 *
 * A deterministic goal-management layer. It turns an ordered task outline into
 * a validated dependency graph, selects runnable work, and requires evidence
 * before completion. The graph is deliberately separate from model prose.
 */

export const ULTRON_GOAL_ENGINE_VERSION = "1.0.0" as const;
export type GoalStatus = "pending" | "ready" | "active" | "blocked" | "completed" | "failed" | "cancelled";
export type GoalKind = "understand" | "retrieve" | "reason" | "act" | "verify" | "deliver";
export type UltronGoal = {
  id: string;
  title: string;
  objective: string;
  kind: GoalKind;
  parentId?: string;
  dependsOn: string[];
  priority: number;
  status: GoalStatus;
  completionCriteria: string[];
  evidence?: string;
  blocker?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};
export type UltronGoalGraph = {
  id: string;
  objective: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "blocked" | "completed" | "failed";
  goals: UltronGoal[];
  hardConstraints: string[];
  revision: number;
};
export type GoalGraphValidation = { valid: boolean; errors: string[]; topologicalOrder: string[] };
export type GoalTransition = { ok: boolean; graph: UltronGoalGraph; reason?: string };

const now = (): number => Date.now();
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Builds a conservative linear dependency graph from a deterministic plan. */
export function createUltronGoalGraph(
  id: string,
  objective: string,
  steps: readonly { id: string; objective: string; kind: GoalKind; completionSignal?: string }[],
  hardConstraints: readonly string[] = [],
): UltronGoalGraph {
  const timestamp = now();
  const goals = steps.map((step, index): UltronGoal => ({
    id: step.id,
    title: step.kind.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    objective: step.objective,
    kind: step.kind,
    dependsOn: index === 0 ? [] : [steps[index - 1]!.id],
    priority: Math.max(1, 100 - index * 5),
    status: index === 0 ? "ready" : "pending",
    completionCriteria: [step.completionSignal ?? "The stated objective has been completed and evidence is recorded."],
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  return { id, objective, createdAt: timestamp, updatedAt: timestamp, status: "active", goals, hardConstraints: hardConstraints.slice(0, 40), revision: 1 };
}

/** Validates references, uniqueness, parent structure and cycles. */
export function validateUltronGoalGraph(graph: UltronGoalGraph): GoalGraphValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const goal of graph.goals) {
    if (!goal.id.trim()) errors.push("A goal has an empty identifier.");
    if (ids.has(goal.id)) errors.push(`Duplicate goal identifier: ${goal.id}.`);
    ids.add(goal.id);
    if (!goal.objective.trim()) errors.push(`Goal ${goal.id} has no objective.`);
    if (!goal.completionCriteria.length) errors.push(`Goal ${goal.id} has no completion criteria.`);
  }
  for (const goal of graph.goals) {
    if (goal.parentId && !graph.goals.some((item) => item.id === goal.parentId)) errors.push(`Goal ${goal.id} references missing parent ${goal.parentId}.`);
    for (const dependency of goal.dependsOn) if (!ids.has(dependency)) errors.push(`Goal ${goal.id} references missing dependency ${dependency}.`);
    if (goal.dependsOn.includes(goal.id)) errors.push(`Goal ${goal.id} depends on itself.`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const topologicalOrder: string[] = [];
  const byId = new Map(graph.goals.map((goal) => [goal.id, goal]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) { errors.push(`Dependency cycle detected at ${id}.`); return; }
    visiting.add(id);
    const goal = byId.get(id);
    for (const dependency of goal?.dependsOn ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    topologicalOrder.push(id);
  };
  for (const goal of graph.goals) visit(goal.id);
  return { valid: errors.length === 0, errors: [...new Set(errors)], topologicalOrder: errors.length ? [] : topologicalOrder };
}

/** Selects runnable goals by priority while respecting all prerequisites. */
export function getReadyUltronGoals(graph: UltronGoalGraph, limit = 3): UltronGoal[] {
  if (graph.status !== "active" || !validateUltronGoalGraph(graph).valid) return [];
  const byId = new Map(graph.goals.map((goal) => [goal.id, goal]));
  return graph.goals
    .filter((goal) => goal.status === "pending" || goal.status === "ready")
    .filter((goal) => goal.dependsOn.every((id) => byId.get(id)?.status === "completed"))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
    .slice(0, clamp(limit, 1, 10))
    .map((goal) => ({ ...goal, status: "ready" }));
}

/** Strict state machine: blocked dependencies and evidence-free completion fail closed. */
export function transitionUltronGoal(
  graph: UltronGoalGraph,
  goalId: string,
  next: GoalStatus,
  details: { evidence?: string; blocker?: string } = {},
): GoalTransition {
  const validation = validateUltronGoalGraph(graph);
  if (!validation.valid) return { ok: false, graph, reason: `Invalid goal graph: ${validation.errors.join(" ")}` };
  const index = graph.goals.findIndex((goal) => goal.id === goalId);
  if (index < 0) return { ok: false, graph, reason: "Unknown goal." };
  const goal = graph.goals[index]!;
  const transitions: Record<GoalStatus, GoalStatus[]> = {
    pending: ["ready", "cancelled"], ready: ["active", "blocked", "cancelled"], active: ["completed", "blocked", "failed"],
    blocked: ["ready", "cancelled"], failed: ["ready", "cancelled"], completed: [], cancelled: [],
  };
  if (!transitions[goal.status].includes(next)) return { ok: false, graph, reason: `Invalid goal transition ${goal.status} -> ${next}.` };
  if (next === "active" && !goal.dependsOn.every((id) => graph.goals.find((item) => item.id === id)?.status === "completed")) return { ok: false, graph, reason: "Prerequisite goals are not complete." };
  if (next === "completed" && !details.evidence?.trim()) return { ok: false, graph, reason: "Goal completion requires verifiable evidence." };
  if (next === "blocked" && !details.blocker?.trim()) return { ok: false, graph, reason: "A blocked goal requires a concrete blocker description." };

  const goals = graph.goals.map((item, itemIndex) => itemIndex === index ? {
    ...item,
    status: next,
    attempts: item.attempts + (next === "active" ? 1 : 0),
    ...(details.evidence ? { evidence: details.evidence.slice(0, 1200) } : {}),
    ...(details.blocker ? { blocker: details.blocker.slice(0, 500) } : {}),
    updatedAt: now(),
  } : { ...item });
  const status = goals.every((item) => item.status === "completed" || item.status === "cancelled") ? "completed"
    : goals.some((item) => item.status === "blocked") ? "blocked"
      : goals.some((item) => item.status === "failed") ? "failed" : "active";
  return { ok: true, graph: { ...graph, goals, status, revision: graph.revision + 1, updatedAt: now() } };
}

/** Adds a newly discovered hard constraint and invalidates the graph revision. */
export function addUltronGoalConstraint(graph: UltronGoalGraph, constraint: string): UltronGoalGraph {
  const normalized = constraint.trim().slice(0, 500);
  if (!normalized || graph.hardConstraints.includes(normalized)) return graph;
  return { ...graph, hardConstraints: [...graph.hardConstraints, normalized].slice(-40), revision: graph.revision + 1, updatedAt: now() };
}

/** Prompt representation exposes goals and dependencies, not model scratchwork. */
export function buildUltronGoalPrompt(graph: UltronGoalGraph): string {
  const validation = validateUltronGoalGraph(graph);
  const rows = graph.goals.map((goal, index) => `${index + 1}. ${goal.id} [${goal.status}; priority ${goal.priority}]${goal.dependsOn.length ? ` after ${goal.dependsOn.join(", ")}` : ""}: ${goal.objective} | completion: ${goal.completionCriteria.join("; ")}`).join("\n");
  return [
    `ULTRON GOAL GRAPH v${ULTRON_GOAL_ENGINE_VERSION} · revision ${graph.revision}`,
    `Objective: ${graph.objective}`,
    `Graph validation: ${validation.valid ? "valid" : `invalid: ${validation.errors.join(" ")}`}`,
    `Hard constraints: ${graph.hardConstraints.join("; ") || "Preserve the current user request and established project constraints."}`,
    rows,
    "Execute only goals whose dependencies are complete. Do not mark a goal completed without concrete evidence. Re-evaluate the graph when a new correction, blocker or hard constraint changes the objective.",
  ].join("\n");
}
