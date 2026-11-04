import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type CapabilityData = { ok?: boolean; runs?: Row[]; tools?: Row[]; proposals?: Row[]; events?: Row[]; counts?: Record<string, number>; instance?: string };
type RuntimeInvoke = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Invoke = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;

const asRows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
const str = (row: Row, key: string, fallback = "—") => typeof row[key] === "string" && row[key] ? String(row[key]) : fallback;
const date = (value: unknown) => typeof value === "string" && value ? new Date(value).toLocaleString() : "Time unavailable";
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (value) node.textContent = value; return node;
};
function button(label: string, style: string, action: () => void): HTMLButtonElement {
  const node = el("button", style, label); node.type = "button"; node.addEventListener("click", action); return node;
}
function empty(message: string): HTMLElement { return el("p", "capability-empty", message); }
function card(title: string, meta: string, description: string): HTMLElement {
  const node = el("article", "capability-card");
  const top = el("div", "capability-card-top"); top.append(el("strong", "", title), el("span", "capability-state", meta));
  node.append(top, el("p", "capability-card-description", description)); return node;
}

export function initCapabilityPanel(invoke: Invoke, runtimeInvoke: RuntimeInvoke, client: SupabaseClient): void {
  const root = document.querySelector<HTMLElement>("#capabilities-screen");
  if (!root) return;
  const connection = root.querySelector<HTMLElement>("#capability-connection")!;
  const stats = root.querySelector<HTMLElement>("#capability-stats")!;
  const feedback = root.querySelector<HTMLElement>("#capability-feedback")!;
  const toolsEl = root.querySelector<HTMLElement>("#capability-tools")!;
  const proposalsEl = root.querySelector<HTMLElement>("#capability-proposals")!;
  const runsEl = root.querySelector<HTMLElement>("#capability-runs")!;
  const eventsEl = root.querySelector<HTMLElement>("#capability-events")!;
  const cloudToolsEl = root.querySelector<HTMLElement>("#capability-cloud-tools")!;
  const toolRunsEl = root.querySelector<HTMLElement>("#capability-tool-runs")!;
  const cloudSkillsEl = root.querySelector<HTMLElement>("#capability-cloud-skills")!;
  let loading = false;
  let channel: ReturnType<typeof client.channel> | undefined;

  const refresh = async (quiet = false) => {
    if (loading) return;
    loading = true;
    if (!quiet) feedback.textContent = "Refreshing private capability records…";
    try {
      const [data,cloudToolsResult,toolRunsResult,cloudSkillsResult] = await Promise.all([
        invoke("list") as Promise<CapabilityData>,
        runtimeInvoke("list_tools").catch(error=>({runtime_error:String(error)} as Record<string,unknown>)),
        runtimeInvoke("list_tool_runs").catch(error=>({runtime_error:String(error)} as Record<string,unknown>)),
        runtimeInvoke("list_skills").catch(error=>({runtime_error:String(error)} as Record<string,unknown>))
      ]);
      const tools = asRows(data.tools), proposals = asRows(data.proposals), runs = asRows(data.runs), events = asRows(data.events);
      const cloudTools=asRows(cloudToolsResult.tools), toolRuns=asRows(toolRunsResult.runs), cloudSkills=asRows(cloudSkillsResult.skills);
      connection.textContent = "Connected · " + String(data.instance ?? "ULTRON owner instance") + " · authenticated owner session";
      stats.replaceChildren();
      for (const [label, value] of [["TOOLS", tools.length], ["PROPOSALS", proposals.length], ["AGENT RUNS", runs.length], ["EVENTS", events.length]] as const) {
        const item = el("div", "capability-stat"); item.append(el("small", "", label), el("strong", "", String(value))); stats.append(item);
      }
      root.querySelector("#capability-tool-count")!.textContent = String(tools.length);
      root.querySelector("#capability-proposal-count")!.textContent = String(proposals.length);
      root.querySelector("#capability-run-count")!.textContent = String(runs.length);
      root.querySelector("#capability-event-count")!.textContent = String(events.length);
      root.querySelector("#capability-cloud-tool-count")!.textContent=String(cloudTools.length);
      root.querySelector("#capability-tool-run-count")!.textContent=String(toolRuns.length);
      root.querySelector("#capability-cloud-skill-count")!.textContent=String(cloudSkills.length);

      toolsEl.replaceChildren();
      if (!tools.length) toolsEl.append(empty("No generated tools yet. ULTRON can create versioned Python drafts from a conversation."));
      for (const tool of tools) {
        const node = card(str(tool,"tool_key","Unnamed tool")+" · v"+str(tool,"version"), str(tool,"lifecycle_state").replace(/_/g," "), str(tool,"description"));
        const details = el("details","capability-source"); details.append(el("summary","","Inspect exact source · SHA-256 "+str(tool,"source_sha256").slice(0,16)));
        const source = el("pre","capability-code",str(tool,"source_code","Source unavailable")); details.append(source);
        const language = el("small","capability-meta","Language: "+str(tool,"source_language")+" · Created: "+date(tool.created_at)); node.append(language,details);
        const actions = el("div","capability-actions");
        if (tool.lifecycle_state === "pending_approval") actions.append(button("Approve exact version","capability-action capability-approve",async()=>{
          const accepted = window.confirm("Approve this exact source version?\n\nOnly approve code you have inspected. Activation still requires the verified worker.");
          if (!accepted) return;
          try { await invoke("approve_tool",{id:tool.id,source_sha256:tool.source_sha256,owner_confirmation:true,confirmation_phrase:"APPROVE ULTRON TOOL"}); feedback.textContent="Version approved. It is not active until a worker attests to this exact hash."; await refresh(true); }
          catch(error){ feedback.textContent="Approval failed: "+String(error); }
        }));
        if (tool.lifecycle_state === "approved" || tool.lifecycle_state === "active") actions.append(button("Disable","capability-action capability-danger",async()=>{
          if (!window.confirm("Disable this generated tool version?")) return;
          try { await invoke("disable_tool",{id:tool.id}); feedback.textContent="Tool disabled."; await refresh(true); } catch(error){feedback.textContent="Disable failed: "+String(error);}
        }));
        if (actions.childElementCount) node.append(actions);
        toolsEl.append(node);
      }

      cloudToolsEl.replaceChildren();
      if(!cloudTools.length) cloudToolsEl.append(empty("No cloud workflow tools yet. ULTRON can author a workflow and run it immediately."));
      for(const tool of cloudTools){
        const node=card(str(tool,"title",str(tool,"tool_key"))+" · v"+str(tool,"version"),str(tool,"lifecycle_state"),str(tool,"description"));
        node.append(el("small","capability-meta","Runs: "+String(tool.run_count??0)+" · Last: "+date(tool.last_run_at)+" · "+str(tool,"last_run_status","not run")+" · SHA-256 "+str(tool,"workflow_sha256").slice(0,16)));
        const detail=el("details","capability-source");detail.append(el("summary","","Inspect workflow definition"));detail.append(el("pre","capability-workflow",JSON.stringify(tool.workflow??[],null,2)));node.append(detail);
        const actions=el("div","capability-actions");
        if(tool.lifecycle_state==="active")actions.append(button("Run tool","capability-action capability-tool-run",async()=>{
          const raw=window.prompt("Input JSON for "+str(tool,"tool_key")+" (use {} if no input is required):","{}");if(raw===null)return;
          let input:Record<string,unknown>;try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Input must be a JSON object.");input=parsed;}catch(error){feedback.textContent="Invalid tool input: "+String(error);return;}
          feedback.textContent="Running "+str(tool,"tool_key")+" in Supabase…";
          try{const result=await runtimeInvoke("run_tool",{tool_key:tool.tool_key,input});feedback.textContent="Tool result: "+JSON.stringify(result).slice(0,1800);await refresh(true);}catch(error){feedback.textContent="Tool run failed: "+String(error);}
        }));
        if(tool.lifecycle_state!=="archived")actions.append(button("Archive","capability-action capability-danger",async()=>{
          if(!window.confirm("Archive "+str(tool,"tool_key")+" v"+str(tool,"version")+"?"))return;
          try{await runtimeInvoke("archive_tool",{id:tool.id});feedback.textContent="Cloud tool archived.";await refresh(true);}catch(error){feedback.textContent="Archive failed: "+String(error);}
        }));
        node.append(actions);cloudToolsEl.append(node);
      }
      toolRunsEl.replaceChildren();
      if(!toolRuns.length)toolRunsEl.append(empty("No cloud tool executions yet."));
      for(const run of toolRuns){
        const meta=run.metadata&&typeof run.metadata==="object"?run.metadata as Row:{};
        const node=card(str(run,"tool_key","Tool run"),str(run,"status"),run.error_message?str(run,"error_message"):"Run "+String(run.id??"")+" · "+date(run.finished_at??run.requested_at));
        node.append(el("small","capability-meta","Requested "+date(run.requested_at)+" · Finished "+date(run.finished_at)+" · Version "+str(meta,"version","unknown")));
        const detail=el("details","capability-source");detail.append(el("summary","","Inspect execution input and output"));detail.append(el("pre","capability-workflow",JSON.stringify({input:run.input,output:run.output,error:run.error_message,metadata:run.metadata},null,2)));node.append(detail);toolRunsEl.append(node);
      }
      cloudSkillsEl.replaceChildren();
      if(!cloudSkills.length)cloudSkillsEl.append(empty("No shared cloud skills yet. ULTRON can create and improve versioned skills from its work."));
      for(const skill of cloudSkills){
        const node=card(str(skill,"title",str(skill,"skill_key"))+" · v"+str(skill,"version"),str(skill,"status"),str(skill,"description"));
        node.append(el("small","capability-meta","Confidence "+String(skill.confidence??0)+" · Verified runs "+String(skill.verified_runs??0)+" · Uses "+String(skill.usage_count??0)+" · "+date(skill.updated_at)));
        const detail=el("details","capability-source");detail.append(el("summary","","Inspect skill instructions"));detail.append(el("pre","capability-workflow",JSON.stringify({triggers:skill.triggers,instructions:skill.instructions,evidence:skill.evidence},null,2)));node.append(detail);
        const actions=el("div","capability-actions");actions.append(button("Archive skill","capability-action capability-danger",async()=>{
          if(!window.confirm("Archive skill "+str(skill,"skill_key")+" v"+str(skill,"version")+"?"))return;
          try{await runtimeInvoke("archive_skill",{id:skill.id});feedback.textContent="Cloud skill archived.";await refresh(true);}catch(error){feedback.textContent="Archive failed: "+String(error);}
        }));node.append(actions);cloudSkillsEl.append(node);
      }

      proposalsEl.replaceChildren();
      if (!proposals.length) proposalsEl.append(empty("No pending capability changes."));
      for (const proposal of proposals) {
        const node = card(str(proposal,"title","Untitled proposal"),str(proposal,"status")+" · "+str(proposal,"risk_level")+" risk",str(proposal,"description"));
        node.append(el("small","capability-meta",str(proposal,"proposal_kind")+" · "+date(proposal.created_at)+" · Artifact "+str(proposal,"artifact_sha256").slice(0,16)));
        const artifact = el("details","capability-source"); artifact.append(el("summary","","Inspect proposed artifact")); artifact.append(el("pre","capability-code",JSON.stringify(proposal.artifact ?? {},null,2))); node.append(artifact);
        if (proposal.status === "pending") {
          const actions=el("div","capability-actions");
          for(const decision of ["approved","rejected"] as const) actions.append(button(decision==="approved"?"Approve proposal":"Reject proposal","capability-action "+(decision==="rejected"?"capability-danger":"capability-approve"),async()=>{
            const phrase="REVIEW ULTRON CHANGE";
            if(!window.confirm((decision==="approved"?"Approve":"Reject")+" this exact proposal?\n\n"+str(proposal,"title")))return;
            try { await invoke("resolve_proposal",{id:proposal.id,artifact_sha256:proposal.artifact_sha256,decision,owner_confirmation:true,confirmation_phrase:phrase}); feedback.textContent="Proposal "+decision+". Approval records a decision; it does not silently apply production changes."; await refresh(true); }
            catch(error){feedback.textContent="Proposal decision failed: "+String(error);}
          }));
          node.append(actions);
        }
        proposalsEl.append(node);
      }

      runsEl.replaceChildren();
      if(!runs.length) runsEl.append(empty("No agent runs have been checkpointed yet."));
      for(const run of runs){
        const node=card(str(run,"goal","Agent run"),str(run,"status")+" · "+str(run,"phase"),"Iteration "+String(run.iteration??0)+" / "+String(run.iteration_limit??0)+" · Tokens "+String(run.tokens_used??0)+(run.error_message?" · "+str(run,"error_message"):""));
        node.append(el("small","capability-meta","Updated "+date(run.updated_at)));
        if(run.checkpoint && typeof run.checkpoint==="object"){const detail=el("details","capability-source");detail.append(el("summary","","Inspect checkpoint"));detail.append(el("pre","capability-code",JSON.stringify(run.checkpoint,null,2)));node.append(detail);}
        runsEl.append(node);
      }
      eventsEl.replaceChildren();
      if(!events.length) eventsEl.append(empty("No capability events recorded yet."));
      for(const event of events){
        const node=el("article","capability-event");node.append(el("strong","","#"+String(event.id??"")+" · "+str(event,"event_type")),el("small",""," "+date(event.created_at)));
        const detail=el("details","capability-source");detail.append(el("summary","","Event details"));detail.append(el("pre","capability-code",JSON.stringify(event.details??{},null,2)));node.append(detail);eventsEl.append(node);
      }
      feedback.textContent="Synced · latest records loaded from Supabase. "+(tools.length?"Tool source hashes and lifecycle states are visible.":"Ready for ULTRON to propose its first tool.");
    } catch(error) {
      connection.textContent="Not connected · owner session required";
      feedback.textContent="Could not load capability records: "+(error instanceof Error?error.message:String(error));
    } finally { loading=false; }
  };
  root.querySelector("#capability-refresh")!.addEventListener("click",()=>void refresh());
  root.querySelector("#capabilities-back")!.addEventListener("click",()=>document.querySelector<HTMLButtonElement>("#nav-chat")?.click());
  void refresh();
  void client.auth.getSession().then(({data})=>{
    if(!data.session)return;
    channel=client.channel("ultron-capability-console")
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_generated_tools"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_capability_proposals"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_agent_runs"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_capability_events"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_tool_specs"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_tool_runs"},()=>void refresh(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"ultron_skills"},()=>void refresh(true))
      .subscribe();
  }).catch(()=>{});
  window.addEventListener("pagehide",()=>{if(channel)void client.removeChannel(channel);},{once:true});
}
