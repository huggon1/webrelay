import {
  actionPresetSchema,
  createUrlPattern,
  extractionProfileSchema,
  extractionRecipeSchema,
  matchesUrlPattern,
  type ActionPreset,
  type ExtractionProfile,
} from "@extractor/shared";
import type { BackgroundRequest, BackgroundResponse, GenerateArtifactRequest, StudioJob } from "./messages.js";
import { selectGenerateMode } from "./studio-mode.js";

let currentUrl = "";
let profiles: ExtractionProfile[] = [];
let editingProfile: ExtractionProfile | null = null;
let editorSource: "manual-new" | "manual-edit" | "studio-candidate" = "manual-new";
let listScope: "current" | "all" = "current";
let studioPollTimer: number | undefined;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node as T;
}

async function send(message: BackgroundRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(message);
}

function switchTab(tab: "quickrun" | "studio") {
  const isQuickRun = tab === "quickrun";
  if (isQuickRun) stopStudioPolling();
  el("panel-quickrun").classList.toggle("hidden", !isQuickRun);
  el("panel-studio").classList.toggle("hidden", isQuickRun);
  el("screen-edit").classList.add("hidden");
  el("tab-quickrun").classList.toggle("active", isQuickRun);
  el("tab-studio").classList.toggle("active", !isQuickRun);
  clearStatus();
}

function setStatus(message: string, isError = false) {
  const bar = el("status-bar");
  bar.textContent = message;
  bar.className = `status-bar${isError ? " status-bar--error" : ""}`;
}

function clearStatus() {
  setStatus("");
}

function setLoading(id: string, loading: boolean) {
  const button = el<HTMLButtonElement>(id);
  button.disabled = loading;
  if (loading) {
    button.dataset.originalText = button.textContent ?? "";
    button.textContent = "Working...";
  } else {
    button.textContent = button.dataset.originalText ?? button.textContent;
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTimeAgo(iso?: string) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function actionOptions(selected: ActionPreset["type"]) {
  const options: { value: ActionPreset["type"]; label: string }[] = [
    { value: "copy", label: "Copy" },
    { value: "download", label: "Download" },
    { value: "copy_download", label: "Copy + Download" },
  ];
  return options
    .map((option) => `<option value="${option.value}"${option.value === selected ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

function showList() {
  el("panel-quickrun").classList.remove("hidden");
  el("panel-studio").classList.add("hidden");
  el("screen-list").classList.remove("hidden");
  el("screen-edit").classList.add("hidden");
  el("tab-quickrun").classList.add("active");
  el("tab-studio").classList.remove("active");
  editingProfile = null;
  editorSource = "manual-new";
}

function showEditor(
  profile: ExtractionProfile | null,
  options: { source?: "manual-new" | "manual-edit" | "studio-candidate"; namePlaceholder?: string } = {},
) {
  editingProfile = profile;
  editorSource = options.source ?? (profile ? "manual-edit" : "manual-new");
  el("panel-quickrun").classList.add("hidden");
  el("panel-studio").classList.add("hidden");
  el("screen-list").classList.add("hidden");
  el("screen-edit").classList.remove("hidden");
  el("editor-title").textContent = editorSource === "manual-edit" ? "Edit Profile" : "New Profile";
  const nameInput = el<HTMLInputElement>("profile-name");
  nameInput.value = editorSource === "manual-edit" ? profile?.name ?? "" : "";
  nameInput.placeholder = editorSource === "manual-edit" ? "Profile name" : "";
  el<HTMLInputElement>("profile-url-pattern").value = profile?.urlPattern ?? createUrlPattern(currentUrl);
  el<HTMLSelectElement>("profile-action").value = profile?.actionPreset.type ?? "copy";
  el<HTMLTextAreaElement>("profile-recipe").value = profile ? JSON.stringify(profile.recipe, null, 2) : "";
  el<HTMLTextAreaElement>("profile-script").value = profile?.script.code ?? "";
  el("preview-input").textContent = "";
  el("preview-output").textContent = "";
  el<HTMLDetailsElement>("preview-panel").open = false;
  clearStatus();
}

function renderProfiles() {
  const list = el("profile-list");
  list.innerHTML = "";

  if (profiles.length === 0) {
    list.innerHTML = `<p class="empty">${listScope === "current" ? "No profiles for this page yet." : "No saved profiles yet."}</p>`;
    return;
  }

  for (const profile of profiles) {
    const matchesCurrentUrl = matchesUrlPattern(profile.urlPattern, currentUrl);
    const card = document.createElement("article");
    card.className = `profile-card${profile.status === "possibly_failed" ? " profile-card--failed" : ""}`;
    card.innerHTML = `
      <div class="profile-main">
        <span class="profile-title">${profile.status === "possibly_failed" ? "Warning: " : ""}${escapeHtml(profile.name)}</span>
        <div class="profile-actions">
          <button class="btn-primary btn-small" data-run="${escapeHtml(profile.id)}"${matchesCurrentUrl ? "" : " disabled"}>${matchesCurrentUrl ? "Run" : "No match"}</button>
          <button class="btn-ghost btn-small" data-edit="${escapeHtml(profile.id)}">Edit</button>
          <button class="btn-ghost btn-small btn-danger" data-delete="${escapeHtml(profile.id)}">Delete</button>
        </div>
      </div>
      <div class="profile-meta">
        <select class="profile-action-select" data-action="${escapeHtml(profile.id)}">${actionOptions(profile.actionPreset.type)}</select>
        <span>Last run: ${formatTimeAgo(profile.lastRunAt)}</span>
        <span class="profile-pattern" title="${escapeHtml(profile.urlPattern)}">${escapeHtml(profile.urlPattern)}</span>
      </div>
    `;
    list.appendChild(card);
  }

  list.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", () => void runProfile(button.dataset.run!));
  });
  list.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => {
    const profile = profiles.find((candidate) => candidate.id === button.dataset.edit);
    if (profile) button.addEventListener("click", () => showEditor(profile, { source: "manual-edit" }));
  });
  list.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => void deleteProfile(button.dataset.delete!));
  });
  list.querySelectorAll<HTMLSelectElement>("[data-action]").forEach((select) => {
    select.addEventListener("change", () => void updateProfileAction(select.dataset.action!, select.value as ActionPreset["type"]));
  });
}

async function load() {
  const tabResponse = await send({ type: "GET_ACTIVE_TAB" });
  if (!tabResponse.ok || !("tab" in tabResponse)) {
    setStatus(tabResponse.ok ? "No active tab." : tabResponse.error, true);
    return;
  }
  currentUrl = tabResponse.tab.url;
  const url = new URL(currentUrl);
  el("current-url").textContent = url.protocol === "file:" ? "local file" : url.hostname;

  el("scope-current").classList.toggle("active", listScope === "current");
  el("scope-all").classList.toggle("active", listScope === "all");

  const profilesResponse =
    listScope === "current"
      ? await send({ type: "LIST_PROFILES_FOR_SITE", url: currentUrl })
      : await send({ type: "LIST_ALL_PROFILES" });
  if (!profilesResponse.ok || !("profiles" in profilesResponse)) {
    setStatus(profilesResponse.ok ? "Could not load profiles." : profilesResponse.error, true);
    return;
  }
  profiles = profilesResponse.profiles;
  renderProfiles();
  renderStudioProfileOptions();
}

function renderStudioProfileOptions() {
  const select = el<HTMLSelectElement>("studio-base-profile");
  const selected = select.value;
  select.innerHTML = '<option value="">None - create a new profile</option>';
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    select.append(option);
  }
  select.value = profiles.some((profile) => profile.id === selected) ? selected : "";
}

function buildProfileFromForm(): ExtractionProfile {
  const now = new Date().toISOString();
  const recipeText = el<HTMLTextAreaElement>("profile-recipe").value;
  let recipeJson: unknown;
  try {
    recipeJson = JSON.parse(recipeText);
  } catch (error) {
    throw new Error(`Recipe JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const name = el<HTMLInputElement>("profile-name").value.trim();
  if (!name) throw new Error("Name is required.");
  const urlPattern = el<HTMLInputElement>("profile-url-pattern").value.trim();
  if (!urlPattern) throw new Error("URL pattern is required.");
  const actionPreset = actionPresetSchema.parse({ type: el<HTMLSelectElement>("profile-action").value });
  const recipe = extractionRecipeSchema.parse(recipeJson);
  const code = el<HTMLTextAreaElement>("profile-script").value.trim();
  if (!code) throw new Error("JS transform body is required.");

  return extractionProfileSchema.parse({
    id: editorSource === "manual-edit" && editingProfile ? editingProfile.id : `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    urlPattern,
    recipe,
    script: { version: 1, code },
    actionPreset,
    status: editingProfile?.status ?? "ok",
    lastRunAt: editingProfile?.lastRunAt,
    createdAt: editorSource === "manual-edit" && editingProfile ? editingProfile.createdAt : now,
    updatedAt: now,
    version: editorSource === "manual-edit" && editingProfile ? editingProfile.version + 1 : 1,
  });
}

async function saveProfile() {
  clearStatus();
  setLoading("btn-save", true);
  try {
    const profile = buildProfileFromForm();
    const response = await send({ type: "SAVE_PROFILE", profile });
    if (!response.ok) throw new Error(response.error);
    setStatus("Profile saved.");
    showList();
    await load();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setLoading("btn-save", false);
  }
}

async function previewProfile() {
  clearStatus();
  setLoading("btn-preview", true);
  try {
    const profile = buildProfileFromForm();
    const response = await send({ type: "RUN_PROFILE_PREVIEW", profile });
    if (!response.ok) throw new Error(response.error);
    if (!("scriptInput" in response) || !("extraction" in response)) throw new Error("Preview failed.");
    el("preview-input").textContent = response.scriptInput;
    el("preview-output").textContent = response.output;
    el<HTMLDetailsElement>("preview-panel").open = true;
    setStatus(response.extraction.ok ? "Preview complete." : "Preview returned extraction warnings.", !response.extraction.ok);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setLoading("btn-preview", false);
  }
}

async function runProfile(profileId: string) {
  clearStatus();
  const select = document.querySelector<HTMLSelectElement>(`.profile-action-select[data-action="${CSS.escape(profileId)}"]`);
  const actionPresetOverride = select ? { type: select.value as ActionPreset["type"] } : undefined;
  try {
    const response = await send({ type: "RUN_PROFILE", profileId, actionPresetOverride });
    if (!response.ok || !("run" in response)) throw new Error(response.ok ? "Run failed." : response.error);
    const errors = response.run.actionResult.errors;
    if (errors.length > 0) {
      setStatus(errors[0], true);
      return;
    }
    const parts = ([response.run.actionResult.copied && "Copied", response.run.actionResult.downloaded && "Downloaded"] as (string | false)[])
      .filter(Boolean)
      .join(" / ");
    setStatus(parts || "Done");
    await load();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function updateProfileAction(profileId: string, actionType: ActionPreset["type"]) {
  const actionPreset = actionPresetSchema.parse({ type: actionType });
  const response = await send({
    type: "UPDATE_PROFILE",
    profileId,
    updates: { actionPreset, updatedAt: new Date().toISOString() },
  });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Action updated.");
  await load();
}

async function deleteProfile(profileId: string) {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return;
  if (!window.confirm(`Delete "${profile.name}"?`)) return;
  const response = await send({ type: "DELETE_PROFILE", profileId });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Profile deleted.");
  await load();
}

function showStudioEntry() {
  stopStudioPolling();
  el("studio-entry").classList.remove("hidden");
  el("studio-generating").classList.add("hidden");
  clearStudioProcess();
  setStudioControls(null);
}

function showStudioGenerating(initialStage: string) {
  el("studio-entry").classList.add("hidden");
  el("studio-generating").classList.remove("hidden");
  clearStudioProcess();
  setStudioStage(initialStage);
  setStudioControls("running");
}

function setStudioStage(message: string) {
  el("studio-stage").textContent = message;
}

function clearStudioProcess() {
  el("studio-log").innerHTML = "";
  el("studio-artifacts").innerHTML = "";
}

function setStudioControls(status: StudioJob["status"] | null) {
  el<HTMLButtonElement>("btn-cancel-studio").classList.toggle("hidden", status !== "running");
  el<HTMLButtonElement>("btn-clear-studio").classList.toggle("hidden", status === "running" || status === null);
}

function appendProcessLog(kind: string, message: string, isError = false) {
  const row = document.createElement("div");
  row.className = `process-event${isError ? " process-error" : ""}`;
  row.innerHTML = `
    <span class="process-kind">${escapeHtml(kind)}</span>
    <span class="process-message">${escapeHtml(message)}</span>
  `;
  const log = el("studio-log");
  log.append(row);
  log.scrollTop = log.scrollHeight;
}

function appendArtifact(label: string, content: unknown) {
  const details = document.createElement("details");
  details.className = "artifact-box";
  details.open = true;
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  details.innerHTML = `<summary>${escapeHtml(label)}</summary><pre>${escapeHtml(text)}</pre>`;
  el("studio-artifacts").append(details);
}

function handleProgressEvent(event: StudioJob["events"][number]) {
  if (event.type === "stage") {
    setStudioStage(event.message);
    appendProcessLog("stage", event.message);
  } else if (event.type === "reasoning") {
    appendProcessLog("reason", event.message);
  } else if (event.type === "artifact") {
    appendArtifact(event.label, event.content);
  } else if (event.type === "usage") {
    appendProcessLog("usage", `${event.usage.input_tokens} in / ${event.usage.output_tokens} out`);
  } else if (event.type === "error") {
    appendProcessLog("error", event.stage ? `${event.stage}: ${event.message}` : event.message, true);
  }
}

async function runBaseProfileForRevise(baseProfile: ExtractionProfile) {
  const response = await send({ type: "RUN_PROFILE_PREVIEW", profile: baseProfile });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  if (!("scriptInput" in response)) {
    return { ok: false, error: "Base profile preview failed." };
  }
  return {
    ok: response.extraction.ok,
    extraction: response.extraction,
    scriptInput: response.scriptInput,
    output: response.output,
  };
}

function stopStudioPolling() {
  if (studioPollTimer !== undefined) {
    window.clearInterval(studioPollTimer);
    studioPollTimer = undefined;
  }
}

function startStudioPolling() {
  if (studioPollTimer !== undefined) return;
  studioPollTimer = window.setInterval(() => {
    void refreshStudioJob();
  }, 800);
}

function renderStudioEvents(job: StudioJob) {
  clearStudioProcess();
  for (const event of job.events) {
    handleProgressEvent(event);
  }
}

function latestStudioStage(job: StudioJob) {
  const lastStage = [...job.events].reverse().find((event) => event.type === "stage" || event.type === "error");
  if (lastStage?.type === "stage") return lastStage.message;
  if (lastStage?.type === "error") return lastStage.message;
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "error") return "Generation failed";
  if (job.status === "done") return "Generated profile preview complete";
  return "Working...";
}

function renderStudioJob(job: StudioJob | null) {
  if (!job) {
    showStudioEntry();
    return;
  }

  if (job.status === "done" && job.candidateProfile && job.preview) {
    stopStudioPolling();
    showEditor(job.candidateProfile, {
      source: "studio-candidate",
    });
    el("preview-input").textContent = job.preview.scriptInput;
    el("preview-output").textContent = job.preview.output;
    el<HTMLDetailsElement>("preview-panel").open = true;
    setStatus(
      job.preview.extraction.ok ? "Generated profile preview complete." : "Generated profile has extraction warnings.",
      !job.preview.extraction.ok,
    );
    return;
  }

  el("studio-entry").classList.add("hidden");
  el("studio-generating").classList.remove("hidden");
  renderStudioEvents(job);
  setStudioStage(latestStudioStage(job));
  setStudioControls(job.status);

  if (job.status === "running") {
    startStudioPolling();
    return;
  }

  stopStudioPolling();
  if (job.status === "cancelled") {
    setStatus("Generation cancelled.", true);
  } else if (job.status === "error") {
    setStatus(job.error || "Generation failed.", true);
  }
}

async function refreshStudioJob() {
  const response = await send({ type: "GET_STUDIO_JOB" });
  if (!response.ok || !("job" in response)) {
    setStatus(response.ok ? "Could not load Studio job." : response.error, true);
    stopStudioPolling();
    return;
  }
  renderStudioJob(response.job);
}

async function clearStudioJob() {
  const response = await send({ type: "CLEAR_STUDIO_JOB" });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  showStudioEntry();
}

async function cancelStudioJob() {
  const response = await send({ type: "CANCEL_STUDIO_JOB" });
  if (!response.ok || !("job" in response)) {
    setStatus(response.ok ? "Could not cancel Studio job." : response.error, true);
    return;
  }
  renderStudioJob(response.job);
}

async function generateArtifact() {
  clearStatus();
  const existingJob = await send({ type: "GET_STUDIO_JOB" });
  if (existingJob.ok && "job" in existingJob && existingJob.job?.status === "running") {
    renderStudioJob(existingJob.job);
    return;
  }

  const instructions = el<HTMLTextAreaElement>("studio-instructions").value.trim();
  const baseProfileId = el<HTMLSelectElement>("studio-base-profile").value;
  const baseProfile = baseProfileId ? profiles.find((profile) => profile.id === baseProfileId) ?? null : null;
  if (baseProfile && !instructions) {
    setStatus("Describe what to change when using a base profile.", true);
    return;
  }

  showStudioGenerating("Preparing page snapshot");
  setLoading("btn-generate", true);
  try {
    const snapshotResponse = await send({ type: "CREATE_SNAPSHOT" });
    if (!snapshotResponse.ok || !("snapshot" in snapshotResponse)) {
      throw new Error(snapshotResponse.ok ? "Snapshot failed." : snapshotResponse.error);
    }

    const request: GenerateArtifactRequest = {
      url: snapshotResponse.url,
      domSnapshot: snapshotResponse.snapshot,
      mode: selectGenerateMode(!!baseProfile, instructions),
      intent: !baseProfile && instructions ? instructions : undefined,
      userNote: baseProfile ? instructions : undefined,
      baseProfile: baseProfile ?? undefined,
      baseRun: baseProfile ? await runBaseProfileForRevise(baseProfile) : undefined,
    };

    const response = await send({
      type: "START_STUDIO_GENERATE",
      request,
      tabId: snapshotResponse.tabId,
      tabUrl: snapshotResponse.url,
    });
    if (!response.ok || !("job" in response)) throw new Error(response.ok ? "Could not start Studio job." : response.error);
    renderStudioJob(response.job);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    showStudioEntry();
  } finally {
    setLoading("btn-generate", false);
  }
}

async function init() {
  el("btn-new").addEventListener("click", () => showEditor(null));
  el("scope-current").addEventListener("click", () => {
    listScope = "current";
    void load();
  });
  el("scope-all").addEventListener("click", () => {
    listScope = "all";
    void load();
  });
  el("tab-quickrun").addEventListener("click", () => switchTab("quickrun"));
  el("tab-studio").addEventListener("click", () => {
    switchTab("studio");
    void refreshStudioJob();
  });
  el("btn-back").addEventListener("click", () => {
    showList();
    void load();
  });
  el("btn-save").addEventListener("click", () => void saveProfile());
  el("btn-preview").addEventListener("click", () => void previewProfile());
  el("btn-generate").addEventListener("click", () => void generateArtifact());
  el("btn-cancel-studio").addEventListener("click", () => void cancelStudioJob());
  el("btn-clear-studio").addEventListener("click", () => void clearStudioJob());
  await load();
  await refreshStudioJob();
}

document.addEventListener("DOMContentLoaded", () => void init());
