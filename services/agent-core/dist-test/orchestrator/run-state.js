/**
 * L4 - Agent Orchestrator: run state.
 *
 * The append-only event log is the single source of truth for a run. The UI
 * is a projection of it; replay is a re-fold over it. Nothing else is
 * authoritative.
 */
/**
 * Validate that a dependency graph is acyclic and every referenced step exists.
 * A bad plan must be rejected before any tool is invoked.
 */
export function validatePlan(steps) {
    const errors = [];
    const ids = new Set(steps.map((s) => s.id));
    if (ids.size !== steps.length) {
        errors.push('plan contains duplicate step ids');
    }
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            if (!ids.has(dep)) {
                errors.push(`step "${step.id}" depends on unknown step "${dep}"`);
            }
            if (dep === step.id) {
                errors.push(`step "${step.id}" depends on itself`);
            }
        }
    }
    // Cycle detection via Kahn's algorithm.
    const indegree = new Map();
    for (const step of steps)
        indegree.set(step.id, step.dependsOn.length);
    const dependents = new Map();
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            const list = dependents.get(dep) ?? [];
            list.push(step.id);
            dependents.set(dep, list);
        }
    }
    const queue = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
    let visited = 0;
    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined)
            break;
        visited += 1;
        for (const next of dependents.get(id) ?? []) {
            const remaining = (indegree.get(next) ?? 1) - 1;
            indegree.set(next, remaining);
            if (remaining === 0)
                queue.push(next);
        }
    }
    if (visited !== steps.length) {
        errors.push('plan contains a dependency cycle');
    }
    return errors;
}
//# sourceMappingURL=run-state.js.map