import { cloudClient, getCloudSession } from "./cloud-sync";

type ProductProject = {
  id: string; title: string; user_request?: string; selected_topic?: string | null;
  status: string; active_stage: string; progress: number; research_target: number;
  source_counts: { discovered?: number; opened?: number; analyzed?: number; rejected?: number; failed?: number };
  opportunity_brief?: Record<string, unknown>; synthesis_summary?: Record<string, unknown>;
  draft_markdown?: string; preview_html?: string; artifact_id?: string | null; error_message?: string | null;
  created_at?: string; updated_at?: string;
};
type ProductEvent = { sequence: number; stage: string; event_type: string; payload: Record<string, unknown>; created_at: string };
type ProductSource = { id: string; title: string; canonical_url: string; domain: string; fetch_status: string; extraction_summary: string };
type ProductDetail = { project: ProductProject; events: ProductEvent[]; sources: ProductSource[]; documents: Array<{ id: string; title: string; format: string; version: number; byte_size: number; download_url?: string | null }>; download_url?: string | null };
type StudioOptions = { openScreen: () => void; closeScreen: () => void; wakeWorker: () => Promise<unknown> };
let options: StudioOptions | null = null;
let selectedProjectId = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let lastPreviewProjectId = "";
let lastPreviewHtml = "";

const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error("Product Studio screen is missing #" + id);
  return node as T;
};
const node = (tag: string, className?: string, text?: string) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
async function invoke(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!await getCloudSession()) throw new Error("Connect your ULTRON owner account in Settings before creating cloud products.");
  const { data, error } = await cloudClient.functions.invoke("ultron-product-studio", { body: { action, ...payload } });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("Product Studio returned an invalid response.");
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.message ?? result.error));
  if (result.ok !== true) throw new Error("Product Studio did not confirm the operation.");
  return result;
}
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued", identifying: "Identifying opportunity", researching: "Researching",
    synthesizing: "Synthesizing evidence", creating: "Creating product", validating: "Quality review",
    packaging: "Packaging", completed: "Completed", partial: "Draft ready · research incomplete",
    paused: "Paused", waiting_for_provider: "Waiting for a free model", failed: "Failed", cancelled: "Cancelled",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}
function setNotice(message: string, error = false): void {
  const notice = el<HTMLElement>("product-studio-notice");
  notice.textContent = message;
  notice.dataset.state = error ? "error" : "info";
}
function renderProjects(projects: ProductProject[]): void {
  const list = el<HTMLElement>("product-studio-projects");
  list.replaceChildren();
  if (!projects.length) {
    list.append(node("p", "product-studio-empty", "Your projects will appear here. Start with a problem, audience or topic."));
    return;
  }
  for (const project of projects) {
    const button = node("button", "product-project-row") as HTMLButtonElement;
    button.type = "button";
    button.setAttribute("aria-current", String(project.id === selectedProjectId));
    const copy = node("span", "product-project-copy");
    copy.append(node("strong", "", project.title), node("small", "", statusLabel(project.status)));
    const meta = node("span", "product-project-meta", String(project.source_counts?.analyzed ?? 0) + " sources");
    button.append(copy, meta);
    button.addEventListener("click", () => void loadProject(project.id));
    list.append(button);
  }
}
async function loadProjects(): Promise<void> {
  const result = await invoke("list");
  renderProjects(Array.isArray(result.projects) ? result.projects as ProductProject[] : []);
}
function renderCounts(counts: ProductProject["source_counts"]): void {
  const target = el<HTMLElement>("product-source-counts");
  target.replaceChildren();
  for (const [label, key] of [["Discovered","discovered"],["Opened","opened"],["Analyzed","analyzed"],["Rejected","rejected"],["Failed","failed"]] as const) {
    const item = node("div", "product-count");
    item.append(node("strong", "", String(counts?.[key] ?? 0)), node("span", "", label));
    target.append(item);
  }
}
function renderEvents(events: ProductEvent[]): void {
  const list = el<HTMLElement>("product-studio-events");
  list.replaceChildren();
  if (!events.length) {
    list.append(node("p", "product-studio-empty", "Activity will appear here as each stage is committed."));
    return;
  }
  for (const event of events.slice(0, 80)) {
    const row = node("article", "product-event");
    const dot = node("span", "product-event-dot");
    const copy = node("div", "product-event-copy");
    const title = event.event_type.replace(/[._]/g, " ");
    const detail = typeof event.payload?.message === "string" ? event.payload.message : typeof event.payload?.title === "string" ? event.payload.title : "";
    copy.append(node("strong", "", title), node("small", "", detail || event.stage));
    row.append(dot, copy);
    list.append(row);
  }
}
function renderSources(sources: ProductSource[]): void {
  const list = el<HTMLElement>("product-studio-sources");
  list.replaceChildren();
  if (!sources.length) {
    list.append(node("p", "product-studio-empty", "Sources will appear when public research returns accessible pages."));
    return;
  }
  for (const source of sources) {
    const row = node("article", "product-source");
    const link = node("a", "", source.title || source.domain) as HTMLAnchorElement;
    link.href = source.canonical_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    row.append(link, node("small", "", source.domain + " · " + source.fetch_status), node("p", "", source.extraction_summary || "No extract available."));
    list.append(row);
  }
}
function renderDocuments(documents: ProductDetail["documents"]): void {
  const list = el<HTMLElement>("product-studio-documents");
  list.replaceChildren();
  if (!documents.length) {
    list.append(node("p", "product-studio-empty", "Exports will appear here when packaging finishes."));
    return;
  }
  for (const document of documents) {
    const row = node("div", "product-document-row");
    const copy = node("span", "product-document-copy");
    copy.append(node("strong", "", document.title), node("small", "", document.format.toUpperCase() + " · v" + document.version + " · " + Math.max(1, Math.round(document.byte_size / 1024)) + " KB"));
    row.append(copy);
    if (document.download_url) {
      const link = node("a", "product-document-download", "Download") as HTMLAnchorElement;
      link.href = document.download_url;
      link.download = "";
      row.append(link);
    }
    list.append(row);
  }
}
function renderOpportunity(project: ProductProject): void {
  const panel = el<HTMLElement>("product-studio-opportunity");
  panel.replaceChildren();
  const brief = project.opportunity_brief ?? {};
  const synthesis = project.synthesis_summary ?? {};
  const fields: Array<[string, unknown]> = [
    ["Topic", brief.selected_topic], ["Audience", brief.audience], ["Problem", brief.problem],
    ["Market gap", brief.market_gap], ["Product promise", brief.promise],
    ["Evidence synthesis", synthesis.executive_summary],
  ];
  for (const [label, value] of fields) {
    if (typeof value !== "string" || !value.trim()) continue;
    const item = node("div", "product-opportunity-item");
    item.append(node("strong", "", label), node("p", "", value));
    panel.append(item);
  }
  const themes = Array.isArray(synthesis.recurring_themes) ? synthesis.recurring_themes : [];
  if (themes.length) {
    const item = node("div", "product-opportunity-item");
    item.append(node("strong", "", "Recurring themes"));
    const list = node("ul", "product-opportunity-themes");
    for (const theme of themes.slice(0, 8)) {
      const label = typeof theme === "string" ? theme : isRecord(theme) ? String(theme.theme ?? theme.name ?? "") : "";
      if (label) list.append(node("li", "", label));
    }
    item.append(list);
    panel.append(item);
  }
  if (!panel.childElementCount) panel.append(node("p", "product-studio-empty", "ULTRON is still building the opportunity brief and comparing source evidence."));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function renderDetail(detail: ProductDetail): void {
  const project = detail.project;
  el<HTMLElement>("product-studio-start").hidden = true;
  el<HTMLElement>("product-studio-workspace").hidden = false;
  el<HTMLElement>("product-studio-title").textContent = project.title;
  renderOpportunity(project);
  el<HTMLElement>("product-studio-status").textContent = statusLabel(project.status);
  const progress = el<HTMLProgressElement>("product-studio-progress");
  progress.value = Math.max(0, Math.min(100, Number(project.progress) || 0));
  el<HTMLElement>("product-studio-stage").textContent = project.active_stage.replace(/_/g, " ");
  el<HTMLElement>("product-studio-coverage").textContent = " · " + String(project.source_counts?.analyzed ?? 0) + " / " + String(project.research_target) + " analyzed";
  renderCounts(project.source_counts ?? {});
  renderEvents(detail.events ?? []);
  renderSources(detail.sources ?? []);
  renderDocuments(detail.documents ?? []);
  const preview = el<HTMLIFrameElement>("product-studio-preview");
  if (project.preview_html) {
    if (lastPreviewProjectId !== project.id || lastPreviewHtml !== project.preview_html) {
      preview.srcdoc = project.preview_html;
      lastPreviewProjectId = project.id;
      lastPreviewHtml = project.preview_html;
    }
    preview.hidden = false;
    el<HTMLElement>("product-studio-preview-empty").hidden = true;
  } else {
    preview.removeAttribute("srcdoc");
    lastPreviewProjectId = project.id;
    lastPreviewHtml = "";
    preview.hidden = true;
    el<HTMLElement>("product-studio-preview-empty").hidden = false;
    el<HTMLElement>("product-studio-preview-empty").textContent = "The live preview will appear when ULTRON commits the first complete draft.";
  }
  const download = el<HTMLAnchorElement>("product-studio-download");
  if (detail.download_url) {
    download.href = detail.download_url;
    download.hidden = false;
  } else download.hidden = true;
  const cancel = el<HTMLButtonElement>("product-studio-cancel");
  cancel.hidden = !["queued","identifying","researching","synthesizing","creating","validating","packaging","waiting_for_provider"].includes(project.status);
  const resume = el<HTMLButtonElement>("product-studio-resume");
  resume.hidden = !["partial","failed","paused","waiting_for_provider"].includes(project.status);
  resume.textContent = project.status === "partial" ? "Continue research" : project.status === "waiting_for_provider" ? "Retry when a free model is available" : "Retry project";
  const warning = el<HTMLElement>("product-studio-warning");
  warning.hidden = !project.error_message && project.status !== "partial" && project.status !== "waiting_for_provider";
  warning.textContent = project.error_message || (project.status === "partial" ? String(project.synthesis_summary?.coverage_note ?? "The requested research target was not reached. Review the actual source coverage before publication.") : project.status === "waiting_for_provider" ? "ULTRON is waiting for an eligible free model. Search-grounded research needs Google AI Studio; synthesis and drafting can use any eligible connected free provider. Your project remains saved." : "");
}
async function loadProject(id: string): Promise<void> {
  selectedProjectId = id;
  try {
    const result = await invoke("get", { project_id: id }) as unknown as ProductDetail & Record<string, unknown>;
    renderDetail(result);
    await loadProjects();
    startPolling();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not load this project.", true);
  }
}
function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!selectedProjectId || document.hidden) return;
    void invoke("get", { project_id: selectedProjectId }).then((result) => {
      renderDetail(result as unknown as ProductDetail);
      const status = (result.project as ProductProject | undefined)?.status;
      if (["completed","partial","failed","cancelled","paused"].includes(String(status))) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        void loadProjects();
      }
    }).catch(() => setNotice("Connection interrupted. Your project remains saved; reconnect to refresh it."));
  }, 5000);
}
async function startProject(request: string): Promise<void> {
  if (busy) return;
  busy = true;
  const start = el<HTMLButtonElement>("product-studio-submit");
  const discover = el<HTMLButtonElement>("product-studio-discover");
  start.disabled = discover.disabled = true;
  setNotice("Saving your project and queuing durable cloud work…");
  try {
    const target = Number(el<HTMLSelectElement>("product-studio-depth").value);
    const result = await invoke("create", { request, research_target: target, idempotency_key: crypto.randomUUID() });
    const project = result.project as ProductProject;
    selectedProjectId = project.id;
    await loadProject(project.id);
    setNotice("Project queued. ULTRON will work through the stages and save checkpoints in your private cloud.");
    void options?.wakeWorker().catch(() => setNotice("Project is saved. The cloud worker will resume when ULTRON reconnects."));
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not start the project.", true);
  } finally {
    busy = false;
    start.disabled = discover.disabled = false;
  }
}
export function initProductStudio(value: StudioOptions): void {
  options = value;
  el<HTMLFormElement>("product-studio-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void startProject(el<HTMLTextAreaElement>("product-studio-request").value.trim());
  });
  el<HTMLButtonElement>("product-studio-discover").addEventListener("click", () => {
    el<HTMLTextAreaElement>("product-studio-request").value = "";
    void startProject("");
  });
  el<HTMLButtonElement>("product-studio-refresh").addEventListener("click", () => void loadProjects().catch(error => setNotice(error instanceof Error ? error.message : "Refresh failed.", true)));
  el<HTMLButtonElement>("product-studio-back").addEventListener("click", () => options?.closeScreen());
  el<HTMLButtonElement>("product-studio-refresh-list").addEventListener("click", () => void loadProjects().catch(error => setNotice(error instanceof Error ? error.message : "Refresh failed.", true)));
  el<HTMLButtonElement>("product-studio-new").addEventListener("click", () => {
    selectedProjectId = "";
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    el<HTMLElement>("product-studio-workspace").hidden = true;
    el<HTMLElement>("product-studio-start").hidden = false;
    setNotice("Ready to create a new product.");
  });
  el<HTMLButtonElement>("product-studio-resume").addEventListener("click", async () => {
    if (!selectedProjectId) return;
    const button = el<HTMLButtonElement>("product-studio-resume");
    button.disabled = true;
    try {
      await invoke("resume", { project_id: selectedProjectId });
      await loadProject(selectedProjectId);
      setNotice("A new durable research run has been queued.");
      void options?.wakeWorker().catch(() => setNotice("Project saved. ULTRON will resume when the cloud worker is online."));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not resume the project.", true); }
    finally { button.disabled = false; }
  });
  el<HTMLButtonElement>("product-studio-cancel").addEventListener("click", async () => {
    if (!selectedProjectId) return;
    const button = el<HTMLButtonElement>("product-studio-cancel");
    button.disabled = true;
    try {
      await invoke("cancel", { project_id: selectedProjectId });
      await loadProject(selectedProjectId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not cancel the project.", true); }
    finally { button.disabled = false; }
  });
}
export async function openProductStudioScreen(): Promise<void> {
  options?.openScreen();
  setNotice("Loading your private product projects…");
  try {
    await loadProjects();
    if (selectedProjectId) await loadProject(selectedProjectId);
    else {
      el<HTMLElement>("product-studio-start").hidden = false;
      el<HTMLElement>("product-studio-workspace").hidden = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Connect ULTRON cloud to use Product Studio.", true);
  }
}
