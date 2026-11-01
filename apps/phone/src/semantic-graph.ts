export type GraphNode = { id: string; label: string; kind: "concept" | "project" | "decision" | "person" | "preference" | "session"; summary: string; sources: string[]; updatedBy: string; confidence: number };
export type GraphEdge = { id: string; from: string; to: string; relation: string; sources: string[]; updatedBy: string; confidence: number };
export type SemanticGraph = { version: 1; updatedAt: number; nodes: GraphNode[]; edges: GraphEdge[] };
export type GraphProposal = { nodes: Array<Omit<GraphNode, "updatedBy">>; edges: Array<Omit<GraphEdge, "updatedBy">> };
export const EMPTY_GRAPH: SemanticGraph = { version: 1, updatedAt: 0, nodes: [], edges: [] };
export function graphPrompt(graph: SemanticGraph, model: string, conversationId: string): string {
  const compact = JSON.stringify({ nodes: graph.nodes.slice(-80), edges: graph.edges.slice(-120) }).slice(0, 9000);
  return `SHARED ULTRAN SEMANTIC KNOWLEDGE GRAPH. Model: ${model}. Current source session: ${conversationId}.
Read this graph as shared memory available to every loaded brain. Use it to ground answers, identify relevant context, and notice contradictions. Never treat an uncertain inference as a confirmed fact.
CURRENT GRAPH: ${compact}
When useful, propose incremental updates as one JSON object with schema:
{"nodes":[{"id":"stable-kebab-id","label":"Short name","kind":"concept|project|decision|person|preference|session","summary":"Evidence-grounded summary","sources":["conversation-id"],"confidence":0.0}],"edges":[{"id":"stable-edge-id","from":"node-id","to":"node-id","relation":"supports|part_of|depends_on|prefers|decided|contradicts|related_to","sources":["conversation-id"],"confidence":0.0}]}
Only include durable, useful facts supported by this session. Include source conversation IDs. Do not invent graph IDs for absent nodes; use stable descriptive IDs. Do not output a proposal unless asked to organise memory.`;
}
export function mergeGraphProposal(current: SemanticGraph, raw: string, model: string): SemanticGraph {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a < 0 || b <= a) return current;
  let parsed: unknown; try { parsed = JSON.parse(cleaned.slice(a, b + 1)); } catch { return current; }
  if (!parsed || typeof parsed !== "object") return current;
  const proposal = parsed as Partial<GraphProposal>;
  if (!Array.isArray(proposal.nodes) || !Array.isArray(proposal.edges)) return current;
  const nodes = new Map(current.nodes.map(n => [n.id, n]));
  for (const item of proposal.nodes.slice(0, 40)) {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(item.id) || typeof item.label !== "string" || typeof item.summary !== "string" || !Array.isArray(item.sources)) continue;
    const kind = ["concept","project","decision","person","preference","session"].includes(item.kind) ? item.kind : "concept";
    const old = nodes.get(item.id);
    nodes.set(item.id, { id:item.id, label:item.label.slice(0,100), kind, summary:item.summary.slice(0,700), sources:[...new Set([...(old?.sources??[]),...item.sources.filter(x=>typeof x==="string").slice(0,20)])], updatedBy:model, confidence:Math.max(0,Math.min(1,Number(item.confidence)||0.5)) });
  }
  const edges = new Map(current.edges.map(e => [e.id,e]));
  for (const item of proposal.edges.slice(0,80)) {
    if (!item || typeof item.id!=="string" || !/^[a-z0-9][a-z0-9_-]{1,99}$/i.test(item.id) || typeof item.from!=="string" || typeof item.to!=="string" || !nodes.has(item.from) || !nodes.has(item.to) || item.from===item.to || typeof item.relation!=="string" || !Array.isArray(item.sources)) continue;
    const old=edges.get(item.id); edges.set(item.id,{id:item.id,from:item.from,to:item.to,relation:item.relation.slice(0,60),sources:[...new Set([...(old?.sources??[]),...item.sources.filter(x=>typeof x==="string").slice(0,20)])],updatedBy:model,confidence:Math.max(0,Math.min(1,Number(item.confidence)||0.5))});
  }
  return {version:1,updatedAt:Date.now(),nodes:[...nodes.values()].slice(-2000),edges:[...edges.values()].slice(-5000)};
}
