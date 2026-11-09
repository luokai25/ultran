import { cloudClient, getCloudSession } from "./cloud-sync";
import { OFFER_BUILDER_HTML_GZIP_BASE64 } from "./offer-builder-asset";

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
type StudioOptions = { openScreen: () => void; closeScreen: () => void; openCloudSettings: () => void; wakeWorker: () => Promise<unknown> };
let options: StudioOptions | null = null;
let selectedProjectId = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let liveChannel: ReturnType<typeof cloudClient.channel> | null = null;
let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let liveRefreshInFlight = false;
let liveRefreshPending = false;
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
function statusLabel(status: string, errorMessage: string | null = ""): string {
  if (status === "waiting_for_provider" && errorMessage?.includes("daily free Google Search")) return "Waiting for daily free-search reset";
  const labels: Record<string, string> = {
    queued: "Queued", identifying: "Identifying opportunity", researching: "Researching",
    synthesizing: "Synthesizing evidence", creating: "Creating product", validating: "Quality review",
    packaging: "Packaging", completed: "Completed", partial: "Draft ready · review needed",
    paused: "Paused", waiting_for_provider: "Waiting for a free model", failed: "Failed", cancelled: "Cancelled",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}
function setNotice(message: string, error = false): void {
  const notice = el<HTMLElement>("product-studio-notice");
  notice.replaceChildren();
  notice.dataset.state = error ? "error" : "info";
  const needsOwnerAccount = /connect your ultron (owner )?account|owner account.*settings/i.test(message);
  if (needsOwnerAccount && options?.openCloudSettings) {
    notice.append(document.createTextNode("Connect your ULTRON owner account to enable private cloud products. "));
    const connect = document.createElement("button");
    connect.className = "product-studio-connect";
    connect.type = "button";
    connect.textContent = "Open cloud settings";
    connect.addEventListener("click", () => options?.openCloudSettings());
    notice.append(connect);
    return;
  }
  notice.textContent = message;
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
    copy.append(node("strong", "", project.title), node("small", "", statusLabel(project.status, project.error_message)));
    const meta = node("span", "product-project-meta", String(project.source_counts?.analyzed ?? 0) + " sources");
    button.append(copy, meta);
    button.addEventListener("click", () => void loadProject(project.id));
    list.append(button);
  }
}
function showLoadingRows(id: string, count: number): void {
  const target = el<HTMLElement>(id);
  target.replaceChildren();
  for (let index = 0; index < count; index++) {
    const row = node("div", "product-studio-skeleton");
    row.setAttribute("aria-hidden", "true");
    target.append(row);
  }
}
async function loadProjects(): Promise<void> {
  showLoadingRows("product-studio-projects", 3);
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
function renderQuality(project: ProductProject): void {
  const panel = el<HTMLElement>("product-studio-quality");
  panel.replaceChildren();
  const validation = isRecord(project.synthesis_summary?.validation) ? project.synthesis_summary.validation : null;
  if (!validation) {
    panel.append(node("p", "product-studio-empty", "Checks run after ULTRON finishes the first draft."));
    return;
  }
  const checks: Array<[string, string]> = [
    ["minimum_length_passed", "Minimum product length"],
    ["minimum_word_count_passed", "At least 700 words"],
    ["references_section", "References section"],
    ["source_citations_match", "Distinct citations match the source register"],
    ["body_external_links_match_sources", "External links match researched sources"],
    ["contents_section", "Contents section"],
    ["actionable_workflow", "Actionable workflow"],
    ["reusable_asset", "Reusable template or checklist"],
    ["limitations_and_next_steps", "Limitations and next steps"],
    ["placeholder_free", "No unfinished placeholders"],
    ["spreadsheet_csv_valid", "Spreadsheet CSV export (when required)"],
    ["spreadsheet_xlsx_valid", "Editable Excel workbook (when required)"],
    ["presentation_pptx_valid", "Editable PowerPoint deck (when required)"],
    ["docx_export_ready", "Editable Word edition"],
    ["software_code_files_ready", "Source-code examples packaged (when required)"],
    ["editorial_review_passed", "Independent editorial review ready"],
  ];
  const editorialScore = Number(validation.editorial_review_score);
  const summary = node("p", "product-quality-summary", String(validation.word_count ?? 0) + " words · " + String(validation.analyzed_sources ?? 0) + " sources analyzed · " + String(validation.distinct_cited_sources ?? 0) + " cited" + (Number.isFinite(editorialScore) && editorialScore > 0 ? " · editorial " + Math.round(editorialScore) + "/100" : ""));
  panel.append(summary);
  for (const [key, label] of checks) {
    const passed = validation[key] === true;
    const row = node("div", "product-quality-row");
    row.append(node("span", "product-quality-mark " + (passed ? "is-passed" : "is-pending"), passed ? "PASS" : "REVIEW"));
    row.append(node("span", "product-quality-label", label));
    panel.append(row);
  }
  const reviewStatus = String(validation.editorial_review_status ?? "not_run");
  if (reviewStatus === "revised") panel.append(node("p", "product-studio-quality-note", "ULTRON revised the sections flagged by its editorial review. Give the final edition a human review before publication."));
  else if (reviewStatus === "skipped") panel.append(node("p", "product-studio-quality-note", "The independent editorial review was unavailable. Structural and citation checks still ran."));
  else if (reviewStatus === "reviewed_revision_unavailable" || reviewStatus === "reviewed_revision_rejected" || validation.editorial_review_passed !== true) panel.append(node("p", "product-studio-quality-note", "The editorial review recommends a human review before publication."));
  if (validation.quality_checks_passed !== true) {
    panel.append(node("p", "product-studio-quality-note", "This draft is saved, but it did not pass every quality gate. Improve it before publishing or selling."));
  }
}
function renderOpportunity(project: ProductProject): void {
  const panel = el<HTMLElement>("product-studio-opportunity");
  panel.replaceChildren();
  const brief = project.opportunity_brief ?? {};
  const synthesis = project.synthesis_summary ?? {};
  const score = typeof brief.opportunity_score === "number" ? brief.opportunity_score : Number.NaN;
  if (Number.isFinite(score)) {
    const metric = node("div", "product-opportunity-score");
    metric.append(node("strong", "", String(Math.max(0, Math.min(100, Math.round(score)))) + " / 100"), node("span", "", "Opportunity score · " + String(brief.confidence ?? "unrated") + " confidence"));
    panel.append(metric);
  }
  const fields: Array<[string, unknown]> = [
    ["Topic", brief.selected_topic], ["Audience", brief.audience], ["Problem", brief.problem],
    ["Market gap", brief.market_gap], ["Product promise", brief.promise],
    ["Evidence from the market", brief.evidence], ["Existing alternatives", brief.existing_alternatives],
    ["Willingness-to-pay signals", synthesis.willingness_to_pay_signals],
    ["Customer pain points", synthesis.customer_pain_points],
    ["Product requirements", synthesis.product_requirements],
    ["Product outline", synthesis.product_outline],
    ["Research coverage", synthesis.coverage_note],
    ["Stopping reason", synthesis.research_stop_reason],
    ["Counter-evidence", synthesis.counter_evidence], ["Contradictions", synthesis.contradictions],
    ["Recommended format", synthesis.recommended_format ?? brief.product_format],
    ["Evidence synthesis", synthesis.executive_summary ?? synthesis.overview],
  ];
  for (const [label, value] of fields) {
    const values = Array.isArray(value) ? value.map(item => typeof item === "string" ? item : isRecord(item) ? String(item.signal ?? item.text ?? item.theme ?? item.description ?? item.claim ?? item.evidence ?? item.finding ?? "") : "").filter(Boolean) : [];
    const textValue = typeof value === "string" ? value.trim() : "";
    if (!textValue && !values.length) continue;
    const item = node("div", "product-opportunity-item");
    item.append(node("strong", "", label));
    if (textValue) item.append(node("p", "", textValue));
    if (values.length) {
      const list = node("ul", "product-opportunity-themes");
      for (const entry of values.slice(0, 8)) list.append(node("li", "", entry));
      item.append(list);
    }
    panel.append(item);
  }
  const themes = Array.isArray(synthesis.recurring_themes) ? synthesis.recurring_themes : [];
  if (themes.length) {
    const item = node("div", "product-opportunity-item");
    item.append(node("strong", "", "Recurring themes across sources"));
    const list = node("ul", "product-opportunity-themes");
    for (const theme of themes.slice(0, 8)) {
      const label = typeof theme === "string" ? theme : isRecord(theme) ? String(theme.theme ?? theme.name ?? "") : "";
      if (label) {
        const supporting = isRecord(theme) && Array.isArray(theme.supporting_source_numbers) ? " · sources " + theme.supporting_source_numbers.join(", ") : "";
        list.append(node("li", "", label + supporting));
      }
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
  el<HTMLElement>("product-studio-status").textContent = statusLabel(project.status, project.error_message);
  const progress = el<HTMLProgressElement>("product-studio-progress");
  progress.value = Math.max(0, Math.min(100, Number(project.progress) || 0));
  el<HTMLElement>("product-studio-stage").textContent = project.active_stage.replace(/_/g, " ");
  el<HTMLElement>("product-studio-coverage").textContent = " · " + String(project.source_counts?.analyzed ?? 0) + " / " + String(project.research_target) + " analyzed";
  renderCounts(project.source_counts ?? {});
  renderQuality(project);
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
  const pause = el<HTMLButtonElement>("product-studio-pause");
  pause.hidden = !["queued","identifying","researching","synthesizing","creating","validating","packaging","waiting_for_provider"].includes(project.status);
  const resume = el<HTMLButtonElement>("product-studio-resume");
  resume.hidden = !["partial","failed","paused","waiting_for_provider"].includes(project.status);
  resume.textContent = project.status === "partial" ? "Improve draft / continue" : project.status === "waiting_for_provider" ? project.error_message?.includes("daily free Google Search") ? "Retry after daily search reset" : "Retry when a free model is available" : project.status === "paused" ? "Resume project" : "Retry project";
  const warning = el<HTMLElement>("product-studio-warning");
  warning.hidden = !project.error_message && project.status !== "partial" && project.status !== "waiting_for_provider";
  warning.textContent = project.error_message || (project.status === "partial" ? String(project.synthesis_summary?.coverage_note ?? "Review the actual source coverage and quality checks before publication.") : project.status === "waiting_for_provider" ? "ULTRON is waiting for an eligible free model. Search-grounded research needs Google AI Studio; synthesis and drafting can use any eligible connected free provider. Your project remains saved." : "");
}
async function loadProject(id: string): Promise<void> {
  selectedProjectId = id;
  showLoadingRows("product-studio-events", 4);
  showLoadingRows("product-studio-sources", 5);
  showLoadingRows("product-studio-documents", 2);
  showLoadingRows("product-studio-opportunity", 3);
  showLoadingRows("product-source-counts", 5);
  el<HTMLElement>("product-studio-preview-empty").textContent = "Loading your saved product preview…";
  el<HTMLElement>("product-studio-preview-empty").hidden = false;
  el<HTMLElement>("product-studio-preview").hidden = true;
  try {
    const result = await invoke("get", { project_id: id }) as unknown as ProductDetail & Record<string, unknown>;
    renderDetail(result);
    await loadProjects();
    await startLiveUpdates(id);
    startPolling();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not load this project.", true);
  }
}
function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function stopLiveUpdates(): void {
  if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
  liveRefreshTimer = null;
  liveRefreshPending = false;
  if (liveChannel) {
    const channel = liveChannel;
    liveChannel = null;
    void cloudClient.removeChannel(channel).catch(() => undefined);
  }
}
function queueLiveRefresh(projectId: string): void {
  if (projectId !== selectedProjectId) return;
  if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = null;
    void refreshLiveProject(projectId);
  }, 250);
}
async function refreshLiveProject(projectId: string): Promise<void> {
  if (projectId !== selectedProjectId) return;
  if (liveRefreshInFlight) {
    liveRefreshPending = true;
    return;
  }
  liveRefreshInFlight = true;
  try {
    const result = await invoke("get", { project_id: projectId }) as unknown as ProductDetail & Record<string, unknown>;
    if (projectId !== selectedProjectId) return;
    renderDetail(result);
    const status = result.project?.status;
    if (["completed","partial","failed","cancelled","paused"].includes(String(status))) {
      stopPolling();
      stopLiveUpdates();
      void loadProjects();
    }
  } catch {
    setNotice("Live updates are reconnecting. Your saved project remains safe; automatic refresh will retry.");
  } finally {
    liveRefreshInFlight = false;
    if (liveRefreshPending && projectId === selectedProjectId) {
      liveRefreshPending = false;
      queueLiveRefresh(projectId);
    }
  }
}
async function startLiveUpdates(projectId: string): Promise<void> {
  stopLiveUpdates();
  const session = await getCloudSession();
  if (!session || projectId !== selectedProjectId) return;
  liveChannel = cloudClient
    .channel("product-studio:" + projectId)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "ultron_product_projects",
      filter: "id=eq." + projectId,
    }, () => queueLiveRefresh(projectId))
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "ultron_product_events",
      filter: "project_id=eq." + projectId,
    }, () => queueLiveRefresh(projectId))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") queueLiveRefresh(projectId);
    });
}
function startPolling(): void {
  stopPolling();
  // Realtime drives the live workspace; this slower poll is a recovery path
  // for missed events, offline tabs and transient channel disconnects.
  pollTimer = setInterval(() => {
    if (!selectedProjectId || document.hidden) return;
    void invoke("get", { project_id: selectedProjectId }).then((result) => {
      renderDetail(result as unknown as ProductDetail);
      const status = (result.project as ProductProject | undefined)?.status;
      if (["completed","partial","failed","cancelled","paused"].includes(String(status))) {
        stopPolling();
        stopLiveUpdates();
        void loadProjects();
      }
    }).catch(() => setNotice("Connection interrupted. Your project remains saved; reconnect to refresh it."));
  }, 15000);
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
    setNotice("Project queued. ULTRON will keep working in the cloud, even if you close the app, and save each checkpoint privately.");
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
  el<HTMLButtonElement>("product-studio-back").addEventListener("click", () => { stopPolling(); stopLiveUpdates(); options?.closeScreen(); });
  el<HTMLButtonElement>("product-studio-refresh-list").addEventListener("click", () => void loadProjects().catch(error => setNotice(error instanceof Error ? error.message : "Refresh failed.", true)));
  el<HTMLButtonElement>("product-studio-new").addEventListener("click", () => {
    selectedProjectId = "";
    stopPolling();
    stopLiveUpdates();
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
  el<HTMLButtonElement>("product-studio-pause").addEventListener("click", async () => {
    if (!selectedProjectId) return;
    const button = el<HTMLButtonElement>("product-studio-pause");
    button.disabled = true;
    try {
      await invoke("pause", { project_id: selectedProjectId });
      await loadProject(selectedProjectId);
      setNotice("Project paused at its next safe checkpoint. Its saved work is ready to resume.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not pause the project.", true); }
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
let offerBuilderHost: HTMLDivElement | null = null;
let offerBuilderMessageHandler: ((event: MessageEvent) => void) | null = null;

async function decodeOfferBuilderHtml(): Promise<string> {
  const binary = atob(OFFER_BUILDER_HTML_GZIP_BASE64);
  const compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  let html = await new Response(stream).text();
  // srcdoc can expose an opaque origin ("null") inside Android WebView.
  // postMessage rejects "null" as a targetOrigin; use "*" and authenticate
  // every inbound action by the exact iframe WindowProxy below.
  const offerActionMessage = "parent.postMessage({type:'ULTRON_OFFER_ACTION',id,action,payload:payload||{}},location.origin);";
  if (!html.includes(offerActionMessage)) throw new Error("Offer Builder message bridge source was not found.");
  html = html.replace(offerActionMessage, "parent.postMessage({type:'ULTRON_OFFER_ACTION',id,action,payload:payload||{}},'*');");
  const replaceBlock = (source: string, start: string, end: string, replacement: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error("Offer Builder enhancement point not found: " + start);
    return source.slice(0, from) + replacement + "\n" + source.slice(to);
  };

  const summaryStep = [
    "async function s3(){",
    " const T=S.topic,p=S.pocket;",
    " shell(\"<h2>Your eBook Structure</h2><div id='summary'>\"+loader('Generating your eBook summary…','Building the overview from your approved outline and transformation map')+\"</div>\");",
    " try {",
    "  const r=await ultronApi('generate',{project_id:S.projectId,stage:'summary',context:{topic:T,audience:p.aud,pocket:p,outline:S.outline,transformation:{before_after:S.vtm,stages:S.map}}});",
    "  S.summary=r.result||{};S.title=S.summary.title||cap(T)+' for '+p.aud;S.sub=S.summary.subtitle||'A practical guide to '+p.outcome+', without '+p.avoid;",
    "  await saveOfferState('ebook_summary');",
    "  const learn=(S.summary.what_you_learn||S.map.slice(0,4).map(m=>m[1])).map(x=>'<li>'+esc(x)+'</li>').join('');",
    "  const about=esc(S.summary.about||S.outline.promise||'');",
    "  $('#summary').innerHTML=\"<div class='card'><small>EBOOK SUMMARY</small><h3>\"+esc(S.title)+\"</h3><p class='mu'>\"+esc(S.sub)+\"</p><div class='two'><div><b>About this eBook</b><p>\"+about+\"</p></div><div><b>What you’ll learn</b><ul>\"+learn+\"</ul></div></div><div class='meta'><span><b>\"+esc(String(S.summary.predicted_word_count_range||'7,000–11,000'))+ \"</b> words predicted</span><span><b>\"+esc(String(S.summary.reading_minutes||40))+\"</b> min reading time</span><span><b>\"+esc(String(S.summary.chapter_count||7))+\"</b> chapters</span><span><b>\"+esc(String(S.summary.bonus_count||2))+\"</b> bonus materials</span></div><div class='act'><button class='btn' id='cn'>Continue</button></div></div>\";",
    "  $('#cn').onclick=async()=>{await saveOfferState('ebook_summary_approved');ms()};",
    " } catch(e) { $('#summary').innerHTML='<p class=\\\"mu\\\">'+esc(e.message||'Summary generation failed')+'</p><button class=\\\"btn\\\" id=\\\"retry-summary\\\">Retry</button>';$('#retry-summary').onclick=s3; }",
    "}",
  ].join("\n");

  const manuscriptStep = [
    "async function ms(){",
    " const proposed=(S.outline?.chapters||[]).slice(0,7).map(ch=>typeof ch==='string'?ch:(ch.title||'')).filter(Boolean);",
    " const chapterNames=proposed.length===7?proposed:CHAP.slice(0,7);",
    " const names=['Introduction',...chapterNames,'Conclusion','Bonus: Diagnostic Checklist','Bonus: One-Page Action Card'];",
    " const old=Array.isArray(S.secs)?S.secs:[];",
    " S.secs=names.map((name,i)=>{const prior=old.find(x=>x.t===name);return prior||{t:name,k:i===0?'in':i<8?'ch':'bn',html:'',markdown:''}});",
    " S.secs.forEach(section=>{if(!section.markdown&&section.html){const box=document.createElement('div');box.innerHTML=section.html;section.markdown=box.textContent||''}});",
    " S.words=S.secs.reduce((count,section)=>count+(section.markdown?section.markdown.split(/\\s+/).filter(Boolean).length:0),0);",
    " S.pal=S.pal||PAL[hs(S.topic)%3];",
    " shell(\"<h2>Your eBook Structure</h2><div class='card'><div class='pills' id='pl'><span>Chapter plan</span><span>Manuscript</span><span>Branding</span><span>Ready</span></div><div class='row'><span class='mu' id='st'></span><span id='wc' class='mu'>\"+S.words.toLocaleString()+\" words written</span></div><div class='bar'><i id='pb'></i></div><div class='ms'><div class='tocl' id='toc'></div><div class='rd' id='rd'></div></div></div>\");",
    " pill(0);const pending=S.secs.filter(section=>!section.markdown).length;$('#st').textContent=pending<names.length?'Resuming saved manuscript sections…':'Planning your chapters…';$('#pb').style.width=Math.round((names.length-pending)/names.length*80)+'%';",
    " $('#toc').innerHTML=names.map((name,i)=>\"<div id='t\"+i+\"'>\"+(S.secs[i].markdown?'✓':'○')+\" \"+esc(name)+\"</div>\").join('');",
    " $('#rd').innerHTML=names.map((name,i)=>\"<article><small>SECTION \"+String(i+1).padStart(2,'0')+\"</small><h3>\"+esc(name)+\"</h3><div id='b\"+i+\"'>\"+(S.secs[i].html||'')+\"</div></article>\").join('');pill(1);",
    " for(let wave=0;wave<4;wave++){const ids=[0,1,2].map(j=>wave*3+j).filter(i=>i<names.length&&!S.secs[i].markdown);if(!ids.length)continue;toast('Generating wave '+(wave+1)+'/4 ('+ids.length+' sections)');$('#st').textContent='Writing '+ids.length+' sections…';await Promise.all(ids.map(write));$('#pb').style.width=Math.round(S.secs.filter(section=>section.markdown).length/names.length*80+10)+'%'}",
    " $('#st').textContent=names.length+' of '+names.length+' sections complete · quality review';await saveOfferState('manuscript_complete');",
    " try{const review=await ultronApi('generate',{project_id:S.projectId,stage:'quality',context:{topic:S.topic,pocket:S.pocket,outline:S.outline,transformation:{before_after:S.vtm,stages:S.map},sections:S.secs.map(section=>({title:section.t,text:(section.markdown||'').slice(0,2200)}))}});S.quality=review.result||{};await saveOfferState('quality_review');if(S.quality.passed===false)toast('Quality review found items to inspect before publication.')}catch(e){S.quality={error:e.message||'Quality review unavailable'};try{await saveOfferState('quality_review_unavailable')}catch(_){}}",
    " await sleep(350);brand();",
    "}",
  ].join("\n");

  html = replaceBlock(html, "function s3(){", "const pill=", summaryStep);
  html = replaceBlock(html, "async function ms(){", "async function write", manuscriptStep);
  html = html.replace("s.html=b.innerHTML;S.words+=", "s.html=b.innerHTML;s.markdown=content;S.words+=");
  const oldMarkdown = "const markdown='# '+S.title+'\\n\\n'+(S.sub||'')+'\\n\\n'+(S.outline?.promise||'')+'\\n\\n'+S.secs.map(s=>'## '+s.t+'\\n\\n'+(s.markdown||'')).join('\\n\\n');";
  const newMarkdown = "const markdown='# '+S.title+'\\n\\n'+(S.sub||'')+'\\n\\n'+(S.summary?.about||S.outline?.promise||'')+'\\n\\n## What You Will Learn\\n\\n'+(S.summary?.what_you_learn||[]).map(x=>'- '+x).join('\\n')+'\\n\\n## Transformation Map\\n\\n'+S.map.map(x=>'- **'+x[0]+'**: '+x[1]+' '+x[2]).join('\\n')+'\\n\\n## Framework Glossary\\n\\n'+(S.summary?.framework_glossary||[]).map(x=>'- **'+(x.name||'Framework')+'**: '+(x.definition||x.description||'')).join('\\n')+'\\n\\n'+S.secs.map(s=>'## '+s.t+'\\n\\n'+(s.markdown||'')).join('\\n\\n');";
  if (html.includes(oldMarkdown)) {
    html = html.replace(oldMarkdown, newMarkdown);
  } else if (!html.includes(newMarkdown)) {
    // Asset revisions can change quoting and whitespace. Locate the complete
    // markdown assignment by its statement terminator, then replace only that
    // expression. An already-enriched assignment is accepted as-is.
    const markdownMatch = /const\s+markdown\s*=/.exec(html);
    const markdownStart = markdownMatch?.index ?? -1;
    const markdownEnd = markdownStart >= 0 ? html.indexOf(";", markdownStart) : -1;
    if (markdownStart < 0 || markdownEnd < 0) {
      throw new Error("Offer Builder manuscript export block is missing");
    }
    const currentMarkdown = html.slice(markdownStart, markdownEnd + 1);
    const alreadyEnriched = currentMarkdown.includes("S.summary?.about")
      && currentMarkdown.includes("S.summary?.what_you_learn")
      && currentMarkdown.includes("S.map.map")
      && currentMarkdown.includes("framework_glossary")
      && currentMarkdown.includes("S.secs.map");
    if (!alreadyEnriched) {
      html = html.slice(0, markdownStart) + newMarkdown + html.slice(markdownEnd + 1);
    }
  }
  return html;
}

function closeOfferBuilder(): void {
  if (offerBuilderMessageHandler) window.removeEventListener("message", offerBuilderMessageHandler);
  offerBuilderMessageHandler = null;
  offerBuilderHost?.remove();
  offerBuilderHost = null;
  options?.closeScreen();
}

async function waitForOfferBuilderRun(runId: string, frame: HTMLIFrameElement): Promise<Record<string, unknown>> {
  let delay = 1200;
  while (offerBuilderHost && frame.isConnected) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const { data, error } = await cloudClient.functions.invoke("ultron-offer-builder", {
      body: { action: "job_status", run_id: runId },
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      const detail = data && typeof data === "object"
        ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error ?? "Could not read Offer Builder job status.")
        : "Offer Builder returned an invalid job status.";
      throw new Error(detail);
    }
    const run = (data as Record<string, unknown>).run as Record<string, unknown> | undefined;
    if (!run) throw new Error("Offer Builder job status is missing.");
    if (run.status === "completed") {
      return { ok: true, stage: run.requested_stage, result: run.result };
    }
    if (run.status === "failed" || run.status === "cancelled") {
      throw new Error(String(run.error_message ?? (run.status === "cancelled" ? "Generation was cancelled." : "Offer Builder generation failed.")));
    }
    delay = run.status === "waiting_for_provider" ? 8000 : Math.min(4000, delay + 400);
  }
  throw new Error("The Offer Builder view was closed. Its background job continues and can be resumed when you reopen it.");
}

async function mountOfferBuilder(): Promise<void> {
  if (offerBuilderHost) return;
  const session = await getCloudSession();
  const host = document.createElement("div");
  offerBuilderHost = host;
  host.id = "ultron-offer-builder-host";
  Object.assign(host.style, {
    position: "fixed", inset: "0", zIndex: "10000", display: "flex",
    flexDirection: "column", background: "#090a0c", color: "#f2f4f7",
  });
  const toolbar = document.createElement("div");
  Object.assign(toolbar.style, {
    height: "48px", minHeight: "48px", display: "flex", alignItems: "center",
    gap: "14px", padding: "0 14px", background: "#090a0c",
    borderBottom: "1px solid rgba(201,206,214,.16)", font: "12px ui-monospace,monospace",
  });
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "‹ Back to ULTRON";
  Object.assign(back.style, {
    border: "1px solid rgba(201,206,214,.2)", borderRadius: "8px",
    padding: "7px 11px", background: "#171a1f", color: "#e5e7eb", font: "inherit",
  });
  back.addEventListener("click", closeOfferBuilder);
  const heading = document.createElement("strong");
  heading.textContent = "ULTRON / OFFER BUILDER";
  heading.style.letterSpacing = ".12em";
  toolbar.append(back, heading);
  host.append(toolbar);

  if (!session) {
    const message = document.createElement("div");
    Object.assign(message.style, { margin: "auto", maxWidth: "420px", padding: "28px", textAlign: "center", font: "14px/1.6 system-ui,sans-serif" });
    message.textContent = "Connect your ULTRON owner account to use the private AI Offer Builder.";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.textContent = "Open cloud settings";
    connect.style.cssText = "display:block;margin:18px auto 0;padding:12px 18px;border:0;border-radius:10px;background:#e5e7eb;color:#111;font-weight:700";
    connect.addEventListener("click", () => { closeOfferBuilder(); options?.openCloudSettings(); });
    message.append(connect);
    host.append(message);
    document.body.append(host);
    return;
  }

  const frame = document.createElement("iframe");
  frame.title = "ULTRON AI Offer Builder";
  frame.setAttribute("allow", "clipboard-read; clipboard-write");
  Object.assign(frame.style, { width: "100%", height: "calc(100% - 48px)", flex: "1 1 auto", border: "0", background: "#07080a" });
  host.append(frame);
  document.body.append(host);

  offerBuilderMessageHandler = async (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || (event.origin !== location.origin && event.origin !== "null")) return;
    const message = event.data as { type?: string; id?: string; action?: string; payload?: Record<string, unknown> } | null;
    if (!message || message.type !== "ULTRON_OFFER_ACTION" || !message.id || !message.action) return;
    const allowed = new Set(["create", "get", "save", "generate", "finalize"]);
    if (!allowed.has(message.action)) {
      frame.contentWindow?.postMessage({ type: "ULTRON_OFFER_RESULT", id: message.id, error: "Unsupported Offer Builder action." }, "*");
      return;
    }
    try {
      const { data, error } = await cloudClient.functions.invoke("ultron-offer-builder", {
        body: { action: message.action, ...(message.payload ?? {}) },
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
        const detail = data && typeof data === "object" ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error ?? "ULTRON did not confirm the operation.") : "ULTRON returned an invalid response.";
        throw new Error(detail);
      }
      let responseData = data as Record<string, unknown>;
      if (message.action === "generate" && responseData.queued === true && typeof responseData.run_id === "string") {
        void cloudClient.functions.invoke("ultron-jobs", { body: { action: "process", limit: 1 } }).catch(() => undefined);
        responseData = await waitForOfferBuilderRun(responseData.run_id, frame);
      }
      frame.contentWindow?.postMessage({ type: "ULTRON_OFFER_RESULT", id: message.id, result: responseData }, "*");
    } catch (error) {
      frame.contentWindow?.postMessage({
        type: "ULTRON_OFFER_RESULT", id: message.id,
        error: error instanceof Error ? error.message : "Offer Builder request failed.",
      }, "*");
    }
  };
  window.addEventListener("message", offerBuilderMessageHandler);
  try {
    frame.srcdoc = await decodeOfferBuilderHtml();
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = error instanceof Error ? error.message : "Could not load the Offer Builder interface.";
    host.append(message);
  }
}

export async function openProductStudioScreen(): Promise<void> {
  options?.openScreen();
  stopPolling();
  stopLiveUpdates();
  try {
    await mountOfferBuilder();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not open ULTRON Offer Builder.", true);
  }
}
