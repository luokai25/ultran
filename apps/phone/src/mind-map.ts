export type MindConversation = { id: string; title: string; updatedAt: number; messages: Array<{ role: string; content: string }> };
export type MindNode = { id: string; label: string; kind: "root" | "project" | "topic" | "decision" | "session" | "concept" | "person" | "preference"; count: number; conversationIds: string[]; examples: string[]; confidence?: number };
export type MindEdge = { id: string; from: string; to: string; relation: string; confidence?: number };
export type MindMap = { updatedAt: number; nodes: MindNode[]; edges?: MindEdge[] };
type MemoryGraph = { nodes?: Array<{id:string;label:string;kind:string;summary:string;sources?:string[];confidence?:number}>; edges?: Array<{id:string;from:string;to:string;relation:string;confidence?:number}> };
const stop = new Set("the and for that this with from have what when where your you are was were will would could should about into then than also just need make more very some any how can not but use using used want like please okay yeah done does did its our their them they there here because while which who why all every each other one two first next now get got has had been being is in on at to of a an as it or if by be we i me my he she his her do so up out off over under".split(" "));
function terms(value: string): string[] { return (value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []).filter(x => !stop.has(x)); }
export function buildMindMap(conversations: MindConversation[], memory?: MemoryGraph): MindMap {
  const topics = new Map<string, MindNode>(), projects = new Map<string, MindNode>(), decisions = new Map<string, MindNode>(), sessions: MindNode[] = [];
  for (const convo of conversations) {
    const text = convo.messages.map(m => m.content).join(" ").slice(0, 30000), freq = new Map<string, number>();
    for (const word of terms(text)) freq.set(word, (freq.get(word) ?? 0) + 1);
    sessions.push({ id: `session-${convo.id}`, label: convo.title || "Untitled session", kind: "session", count: convo.messages.length, conversationIds: [convo.id], examples: convo.messages.slice(0, 3).map(m => m.content.slice(0, 180)) });
    for (const [word, count] of [...freq].sort((a,b) => b[1]-a[1]).slice(0, 8)) {
      const node = topics.get(word) ?? { id: `topic-${word}`, label: word, kind: "topic" as const, count: 0, conversationIds: [], examples: [] };
      node.count += count; if (!node.conversationIds.includes(convo.id)) node.conversationIds.push(convo.id);
      if (node.examples.length < 3) node.examples.push(`${convo.title}: ${convo.messages.find(m => m.content.toLowerCase().includes(word))?.content.slice(0, 150) ?? ""}`); topics.set(word,node);
    }
    if (convo.title.trim()) { const key=convo.title.toLowerCase(), node=projects.get(key) ?? { id:`project-${projects.size}`, label:convo.title, kind:"project" as const, count:0, conversationIds:[], examples:[] }; node.count+=convo.messages.length; node.conversationIds.push(convo.id); node.examples.push(text.slice(0,150)); projects.set(key,node); }
    for (const msg of convo.messages.filter(m=>m.role==="assistant")) for (const line of msg.content.split("\n").filter(x=>/\b(decided|decision|we will|chosen|selected|agreed|approved|must|should use)\b/i.test(x)).slice(0,2)) {
      const key=line.trim().slice(0,90); if(key.length<14) continue; const node=decisions.get(key)??{id:`decision-${decisions.size}`,label:key,kind:"decision" as const,count:0,conversationIds:[],examples:[]}; node.count++; if(!node.conversationIds.includes(convo.id))node.conversationIds.push(convo.id);node.examples.push(convo.title);decisions.set(key,node);
    }
  }
  const memoryNodes: MindNode[] = (memory?.nodes ?? []).slice(-180).flatMap((item) => {
    const kind = ["concept", "person", "preference", "decision", "project", "session"].includes(item.kind) ? item.kind as MindNode["kind"] : "concept";
    if (!item.id || !item.label) return [];
    return [{ id: `memory-${item.id}`, label: item.label.slice(0, 90), kind, count: item.sources?.length ?? 1, conversationIds: (item.sources ?? []).slice(0, 20), examples: item.summary ? [item.summary.slice(0, 240)] : [], confidence: item.confidence }];
  });
  const root: MindNode={id:"root",label:"Shared knowledge",kind:"root",count:conversations.reduce((n,c)=>n+c.messages.length,0)+memoryNodes.length,conversationIds:conversations.map(c=>c.id),examples:[`${conversations.length} conversations and ${memoryNodes.length} curated memory entries`]};
  const nodes = [root,...projects.values()].concat([...topics.values()].filter(n=>n.conversationIds.length>1||n.count>2).sort((a,b)=>b.count-a.count).slice(0,32),[...decisions.values()].slice(0,16),sessions.slice(0,24),memoryNodes);
  const known = new Set(nodes.map((node) => node.id));
  const edges = (memory?.edges ?? []).filter((edge) => known.has(`memory-${edge.from}`) && known.has(`memory-${edge.to}`)).slice(-400).map((edge) => ({ id: edge.id, from: `memory-${edge.from}`, to: `memory-${edge.to}`, relation: edge.relation, confidence: edge.confidence }));
  return { updatedAt:Date.now(), nodes, edges };
}
export function renderMindMap(svg: SVGSVGElement, map: MindMap, onSelect: (node: MindNode)=>void, query = ""): void {
  const ns="http://www.w3.org/2000/svg"; svg.replaceChildren();
  const center={x:450,y:325};
  const colors:Record<MindNode["kind"],string>={root:"#e5e7eb",project:"#c4c9d1",topic:"#aeb4bd",decision:"#9299a3",session:"#737b86",concept:"#d1d5db",person:"#9ca3af",preference:"#b8bec7"};
  const needle = query.trim().toLocaleLowerCase();
  const visibleNodes = map.nodes.filter((node) => node.kind === "root" || !needle || `${node.label} ${node.kind} ${node.examples.join(" ")}`.toLocaleLowerCase().includes(needle));
  const groups: MindNode[][] = [
    visibleNodes.filter(n=>n.kind==="project"||n.kind==="person"),
    visibleNodes.filter(n=>n.kind==="topic"||n.kind==="concept"),
    visibleNodes.filter(n=>n.kind==="decision"||n.kind==="preference"),
    visibleNodes.filter(n=>n.kind==="session"),
  ];
  const positions = new Map<string,{x:number;y:number}>();
  groups.forEach((group,g)=>group.forEach((node,i)=>{
    const angle=(i/Math.max(1,group.length))*Math.PI*2+g*.42;
    const radius=105+g*57;
    positions.set(node.id,{x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius});
  }));
  for(const edge of map.edges??[]){
    const a=positions.get(edge.from),b=positions.get(edge.to); if(!a||!b)continue;
    const path=document.createElementNS(ns,"path");path.setAttribute("d",`M${a.x} ${a.y} Q${center.x} ${center.y} ${b.x} ${b.y}`);path.setAttribute("stroke","#aeb4bd");path.setAttribute("stroke-opacity",String(.08+Math.max(0,Math.min(1,edge.confidence??.35))*.18));path.setAttribute("stroke-width","1.2");path.setAttribute("fill","none");path.dataset.relation=edge.relation;svg.append(path);
  }
  for(let g=0;g<groups.length;g++) (groups[g]??[]).forEach(node=>{
    const point=positions.get(node.id);if(!point)return;
    const path=document.createElementNS(ns,"path");path.setAttribute("d",`M${center.x} ${center.y} Q${(center.x+point.x)/2} ${(center.y+point.y)/2} ${point.x} ${point.y}`);path.setAttribute("stroke",colors[node.kind]);path.setAttribute("stroke-opacity",".23");path.setAttribute("fill","none");svg.append(path);
    const group=document.createElementNS(ns,"g");group.setAttribute("class","mindmap-node");group.setAttribute("tabindex","0");group.setAttribute("role","button");group.setAttribute("aria-label",`${node.label}, ${node.kind}, ${node.count} references`);
    const circle=document.createElementNS(ns,"circle");circle.setAttribute("cx",String(point.x));circle.setAttribute("cy",String(point.y));circle.setAttribute("r",String(node.kind==="project"?10:node.kind==="person"?9:7));circle.setAttribute("fill",colors[node.kind]);group.append(circle);
    const label=document.createElementNS(ns,"text");label.setAttribute("x",String(point.x+12));label.setAttribute("y",String(point.y+4));label.setAttribute("fill","#d1d5db");label.setAttribute("font-size","10");label.textContent=node.label.slice(0,24);group.append(label);
    group.addEventListener("click",()=>onSelect(node));group.addEventListener("keydown",e=>{if((e as KeyboardEvent).key==="Enter"||(e as KeyboardEvent).key===" "){e.preventDefault();onSelect(node)}});svg.append(group);
  });
  const root=document.createElementNS(ns,"g");root.setAttribute("class","mindmap-root");
  const halo=document.createElementNS(ns,"circle");halo.setAttribute("cx",String(center.x));halo.setAttribute("cy",String(center.y));halo.setAttribute("r","34");halo.setAttribute("fill","#aeb4bd");halo.setAttribute("fill-opacity",".10");root.append(halo);
  const label=document.createElementNS(ns,"text");label.setAttribute("x",String(center.x));label.setAttribute("y",String(center.y+5));label.setAttribute("text-anchor","middle");label.setAttribute("fill",colors.root);label.setAttribute("font-size","17");label.setAttribute("font-weight","700");label.textContent="ULTRON";root.append(label);svg.append(root);
}
export function exportObsidianMarkdown(conversations: MindConversation[], map: MindMap): string {
  const out=["# ULTRON Shared Mind Map","",`Updated: ${new Date(map.updatedAt).toISOString()}`,"",`Sessions: ${conversations.length}`,"","## Sessions"];
  for(const c of conversations){out.push(`### ${c.title}`,`- Updated: ${new Date(c.updatedAt).toISOString()}`);for(const m of c.messages)out.push(`- **${m.role}:** ${m.content.replace(/\s+/g," ").slice(0,1600)}`);out.push("");}
  out.push("## Knowledge graph");
  for (const node of map.nodes.slice(1)) {
    out.push(`- [[${node.label.replace(/[\[\]#|]/g, " ")}]] (${node.kind}; ${node.conversationIds.length} source links; confidence ${node.confidence ?? "derived"})`);
  }
  if (map.edges?.length) {
    out.push("", "## Relationships");
    for (const edge of map.edges) out.push(`- [[${edge.from.replace(/^memory-/, "")}]] --${edge.relation}--> [[${edge.to.replace(/^memory-/, "")}]]`);
  }
  return out.join("\n");
}
