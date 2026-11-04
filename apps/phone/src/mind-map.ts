export type MindConversation = { id: string; title: string; updatedAt: number; messages: Array<{ role: string; content: string }> };
export type MindNode = { id: string; label: string; kind: "root" | "project" | "topic" | "decision" | "session"; count: number; conversationIds: string[]; examples: string[] };
export type MindMap = { updatedAt: number; nodes: MindNode[] };
const stop = new Set("the and for that this with from have what when where your you are was were will would could should about into then than also just need make more very some any how can not but use using used want like please okay yeah done does did its our their them they there here because while which who why all every each other one two first next now get got has had been being is in on at to of a an as it or if by be we i me my he she his her do so up out off over under".split(" "));
function terms(value: string): string[] { return (value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []).filter(x => !stop.has(x)); }
export function buildMindMap(conversations: MindConversation[]): MindMap {
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
  const root: MindNode={id:"root",label:"All knowledge",kind:"root",count:conversations.reduce((n,c)=>n+c.messages.length,0),conversationIds:conversations.map(c=>c.id),examples:[]};
  return { updatedAt:Date.now(), nodes:[root,...projects.values()].concat([...topics.values()].filter(n=>n.conversationIds.length>1||n.count>2).sort((a,b)=>b.count-a.count).slice(0,32),[...decisions.values()].slice(0,16),sessions.slice(0,24)) };
}
export function renderMindMap(svg: SVGSVGElement, map: MindMap, onSelect: (node: MindNode)=>void): void {
  const ns="http://www.w3.org/2000/svg"; svg.replaceChildren(); const center={x:450,y:320};
  const colors={root:"#ff7180",project:"#e52d41",topic:"#70b7c7",decision:"#bd91d4",session:"#7d9f87"};
  const groups=[map.nodes.filter(n=>n.kind==="project"),map.nodes.filter(n=>n.kind==="topic"),map.nodes.filter(n=>n.kind==="decision"),map.nodes.filter(n=>n.kind==="session")];
  for(let g=0;g<groups.length;g++) (groups[g]??[]).forEach((node,i)=>{const angle=i/Math.max(1,groups[g]!.length)*Math.PI*2+g*.35,r=105+g*53,x=center.x+Math.cos(angle)*r,y=center.y+Math.sin(angle)*r;const path=document.createElementNS(ns,"path");path.setAttribute("d",`M450 320 Q${(450+x)/2} ${(320+y)/2} ${x} ${y}`);path.setAttribute("stroke",colors[node.kind]);path.setAttribute("stroke-opacity",".25");path.setAttribute("fill","none");svg.append(path);const group=document.createElementNS(ns,"g");group.setAttribute("class","mindmap-node");group.setAttribute("tabindex","0");group.setAttribute("role","button");group.setAttribute("aria-label",node.label);const circle=document.createElementNS(ns,"circle");circle.setAttribute("cx",String(x));circle.setAttribute("cy",String(y));circle.setAttribute("r",String(node.kind==="project"?10:7));circle.setAttribute("fill",colors[node.kind]);group.append(circle);const label=document.createElementNS(ns,"text");label.setAttribute("x",String(x+12));label.setAttribute("y",String(y+4));label.setAttribute("fill","#ddd7c7");label.setAttribute("font-size","10");label.textContent=node.label.slice(0,24);group.append(label);group.addEventListener("click",()=>onSelect(node));group.addEventListener("keydown",e=>{if((e as KeyboardEvent).key==="Enter")onSelect(node)});svg.append(group);});
  const root=document.createElementNS(ns,"text");root.setAttribute("x","450");root.setAttribute("y","320");root.setAttribute("text-anchor","middle");root.setAttribute("fill",colors.root);root.setAttribute("font-size","18");root.textContent="ULTRON";svg.append(root);
}
export function exportObsidianMarkdown(conversations: MindConversation[], map: MindMap): string {
  const out=["# Ultron Knowledge Vault","",`Updated: ${new Date(map.updatedAt).toISOString()}`,"",`Sessions: ${conversations.length}`,"","## Sessions"];
  for(const c of conversations){out.push(`### ${c.title}`,`- Updated: ${new Date(c.updatedAt).toISOString()}`);for(const m of c.messages)out.push(`- **${m.role}:** ${m.content.replace(/\s+/g," ").slice(0,1600)}`);out.push("");}
  out.push("## Knowledge graph");for(const n of map.nodes.slice(1))out.push(`- [[${n.label.replace(/[\[\]#|]/g,"")}]] (${n.kind}; ${n.conversationIds.length} sessions)`);return out.join("\n");
}
