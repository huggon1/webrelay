import {
  createUrlPattern,
  exportResultSchema,
  type ActionPreset,
  type CodexProgressEvent,
  type ExportResult,
  type ExtractionProfile,
  type ExtractionRecipe,
  type ExtractionResult,
  type TransformSpec,
} from "@extractor/shared";
import type {
  ActionRunResult,
  BackgroundRequest,
  BackgroundResponse,
} from "./messages.js";

const BACKEND_URL = "http://localhost:8787";

// ── Messaging ──────────────────────────────────────────────────────────────

async function send(msg: BackgroundRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg);
}

// ── DOM helpers ────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} not found`);
  return found as T;
}

function setStatus(msg: string, isError = false) {
  const bar = el("status-bar");
  bar.textContent = msg;
  bar.className = `status-bar${isError ? " status-bar--error" : ""}`;
}

function clearStatus() {
  const bar = el("status-bar");
  bar.textContent = "";
  bar.className = "status-bar";
}

function setBtnLoading(id: string, loading: boolean) {
  const btn = el<HTMLButtonElement>(id);
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent ?? "";
    btn.textContent = "Processing...";
  } else {
    btn.textContent = btn.dataset.originalText ?? "";
  }
}

function setProcessStage(message: string) {
  el("cs-process-stage").textContent = message;
}

function resetProcessView(initialStage = "Preparing...") {
  setProcessStage(initialStage);
  el("cs-process-log").innerHTML = "";
  el("cs-process-artifacts").innerHTML = "";
}

function appendProcessLog(kind: string, message: string, isError = false) {
  const row = document.createElement("div");
  row.className = `process-event${isError ? " process-event--error" : ""}`;
  row.innerHTML = `
    <span class="process-event-kind">${escapeHtml(kind)}</span>
    <span class="process-event-message">${escapeHtml(message)}</span>
  `;
  const log = el("cs-process-log");
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function appendProcessArtifact(label: string, content: unknown) {
  const details = document.createElement("details");
  details.className = "process-artifact";
  details.open = true;
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  details.innerHTML = `
    <summary>${escapeHtml(label)}</summary>
    <pre>${escapeHtml(text)}</pre>
  `;
  el("cs-process-artifacts").appendChild(details);
}

function handleProgressEvent(event: CodexProgressEvent) {
  if (event.type === "stage") {
    setProcessStage(event.message);
    appendProcessLog("stage", event.message);
  } else if (event.type === "reasoning") {
    appendProcessLog("reason", event.message);
  } else if (event.type === "artifact") {
    appendProcessArtifact(event.label, event.content);
  } else if (event.type === "usage") {
    appendProcessLog("usage", `${event.usage.input_tokens} in / ${event.usage.output_tokens} out`);
  } else if (event.type === "error") {
    appendProcessLog("error", event.stage ? `${event.stage}: ${event.message}` : event.message, true);
  }
}

async function streamBackend<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Backend stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: T | undefined;

  const consumeChunk = (chunk: string) => {
    buffer += chunk;
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLines = frame
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const event = JSON.parse(dataLines.join("\n")) as CodexProgressEvent;
      handleProgressEvent(event);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") doneResult = event.result as T;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consumeChunk(decoder.decode(value, { stream: true }));
  }
  consumeChunk(decoder.decode());

  if (doneResult === undefined) {
    throw new Error("Backend stream ended without a final result.");
  }
  return doneResult;
}

function formatTimeAgo(iso?: string): string {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Wizard state ───────────────────────────────────────────────────────────

type WizardScreen = "entry" | "extracting" | "result" | "save";

type RefineStreamResult = {
  artifact: {
    recipe: ExtractionRecipe;
    transform?: TransformSpec;
    outputDescription?: string;
  };
  exportResult?: ExportResult;
};

const SCREEN_TO_STEP: Record<WizardScreen, number> = {
  entry: 0,
  extracting: 1,
  result: 2,
  save: 3,
};

const wiz = {
  screen: "entry" as WizardScreen,
  snapshot: "",
  url: "",
  intent: "",
  recipe: null as ExtractionRecipe | null,
  result: null as ExtractionResult | null,
  transform: null as TransformSpec | null,
  exportResult: null as ExportResult | null,
  baseProfileId: null as string | null,
};

function showScreen(screen: WizardScreen) {
  wiz.screen = screen;
  const screens: WizardScreen[] = ["entry", "extracting", "result", "save"];
  screens.forEach((s) => {
    const node = document.getElementById(`cs-${s}`);
    if (node) node.classList.toggle("hidden", s !== screen);
  });
  updateStepIndicator(SCREEN_TO_STEP[screen]);
  el("btn-start-over").classList.toggle("hidden", screen === "entry");
}

function updateStepIndicator(activeStep: number) {
  const indicator = el("step-indicator");
  if (activeStep === 0) {
    indicator.classList.add("hidden");
    return;
  }
  indicator.classList.remove("hidden");
  indicator.querySelectorAll<HTMLElement>(".step-dot").forEach((dot, i) => {
    const step = i + 1;
    dot.classList.remove("step-dot--active", "step-dot--done");
    if (step < activeStep) dot.classList.add("step-dot--done");
    else if (step === activeStep) dot.classList.add("step-dot--active");
  });
}

// ── Transform sandbox ─────────────────────────────────────────────────────

function getSandboxFrame(): HTMLIFrameElement {
  return document.getElementById("transform-sandbox") as HTMLIFrameElement;
}

async function runTransformInSandbox(transform: TransformSpec, data: unknown): Promise<ExportResult> {
  const frame = getSandboxFrame();
  const id = crypto.randomUUID();
  return new Promise<ExportResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Transform sandbox timed out."));
    }, 3000);
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow || (event.data as { id?: string } | null)?.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      const msg = event.data as { id: string; ok: boolean; exportResult?: unknown; error?: string };
      if (msg.ok) {
        resolve(exportResultSchema.parse(msg.exportResult));
        return;
      }
      reject(new Error(msg.error || "Transform sandbox failed."));
    }
    window.addEventListener("message", onMessage);
    frame.contentWindow?.postMessage({ id, type: "RUN_TRANSFORM", transform, data }, "*");
  });
}

// ── Quick Run ──────────────────────────────────────────────────────────────

let siteProfiles: ExtractionProfile[] = [];
let editingProfileId: string | null = null;

async function loadProfiles() {
  const tabResp = await send({ type: "GET_ACTIVE_TAB" });
  if (!tabResp.ok) { setStatus(tabResp.error, true); return; }
  if (!("tab" in tabResp)) return;

  const currentUrl = tabResp.tab.url;
  el("current-url").textContent = new URL(currentUrl).hostname;
  wiz.url = currentUrl;

  const resp = await send({ type: "LIST_PROFILES_FOR_SITE", url: currentUrl });
  if (!resp.ok) { setStatus(resp.error, true); return; }
  if (!("profiles" in resp)) return;

  siteProfiles = resp.profiles;
  renderProfileList();
  renderBaseConfigOptions();
}

function renderProfileList() {
  const list = el("profile-list");
  list.innerHTML = "";

  if (siteProfiles.length === 0) {
    list.innerHTML = '<p class="empty-hint">No configurations for this site yet.</p>';
    return;
  }

  for (const profile of siteProfiles) {
    const failed = profile.status === "possibly_failed";
    const isEditing = editingProfileId === profile.id;
    const card = document.createElement("div");
    card.className = `profile-card${failed ? " profile-card--failed" : ""}`;
    card.dataset.id = profile.id;

    card.innerHTML = isEditing
      ? `
        <div class="profile-card-main profile-card-main--edit">
          <input class="profile-name-input" type="text" value="${escapeHtml(profile.name)}" data-id="${escapeHtml(profile.id)}" />
          <div class="profile-card-actions">
            <button class="btn-rename-save btn-primary btn-small" data-id="${escapeHtml(profile.id)}">Save</button>
            <button class="btn-rename-cancel btn-ghost btn-small" data-id="${escapeHtml(profile.id)}">Cancel</button>
          </div>
        </div>
        <div class="profile-card-meta">
          <label class="profile-action-label">
            Action
            <select class="profile-action-select" data-id="${escapeHtml(profile.id)}">
              ${actionOptions(profile.actionPreset.type)}
            </select>
          </label>
          <span>Last run: ${formatTimeAgo(profile.lastRunAt)}</span>
        </div>`
      : `
        <div class="profile-card-main">
          <span class="profile-name">${failed ? "Warning: " : ""}${escapeHtml(profile.name)}</span>
          <div class="profile-card-actions">
            <button class="btn-run btn-primary btn-small" data-id="${escapeHtml(profile.id)}">Run</button>
            <button class="btn-rename btn-ghost btn-small" data-id="${escapeHtml(profile.id)}">Rename</button>
            <button class="btn-delete btn-ghost btn-small btn-danger" data-id="${escapeHtml(profile.id)}">Delete</button>
          </div>
        </div>
        <div class="profile-card-meta">
          <label class="profile-action-label">
            Action
            <select class="profile-action-select" data-id="${escapeHtml(profile.id)}">
              ${actionOptions(profile.actionPreset.type)}
            </select>
          </label>
          <span>Last run: ${formatTimeAgo(profile.lastRunAt)}</span>
        </div>`;

    list.appendChild(card);
  }

  list.querySelectorAll<HTMLButtonElement>(".btn-run").forEach((btn) => {
    btn.addEventListener("click", () => void runProfile(btn.dataset.id!));
  });
  list.querySelectorAll<HTMLButtonElement>(".btn-rename").forEach((btn) => {
    btn.addEventListener("click", () => startRenameProfile(btn.dataset.id!));
  });
  list.querySelectorAll<HTMLButtonElement>(".btn-rename-cancel").forEach((btn) => {
    btn.addEventListener("click", () => cancelRenameProfile(btn.dataset.id!));
  });
  list.querySelectorAll<HTMLButtonElement>(".btn-rename-save").forEach((btn) => {
    btn.addEventListener("click", () => void saveProfileName(btn.dataset.id!));
  });
  list.querySelectorAll<HTMLInputElement>(".profile-name-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void saveProfileName(input.dataset.id!);
      if (event.key === "Escape") cancelRenameProfile(input.dataset.id!);
    });
    input.focus();
    input.select();
  });
  list.querySelectorAll<HTMLButtonElement>(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => void deleteSavedProfile(btn.dataset.id!));
  });
  list.querySelectorAll<HTMLSelectElement>(".profile-action-select").forEach((select) => {
    select.addEventListener("change", () => void saveProfileAction(select.dataset.id!, select.value as ActionPreset["type"]));
  });
}

function renderBaseConfigOptions() {
  const select = el<HTMLSelectElement>("cs-base-config");
  const selected = wiz.baseProfileId;
  select.innerHTML = [
    '<option value="">Start from scratch</option>',
    ...siteProfiles.map((profile) => (
      `<option value="${escapeHtml(profile.id)}"${profile.id === selected ? " selected" : ""}>${escapeHtml(profile.name)}</option>`
    )),
  ].join("");
  if (selected && !siteProfiles.some((profile) => profile.id === selected)) {
    wiz.baseProfileId = null;
    select.value = "";
  }
}

function startRenameProfile(profileId: string) {
  editingProfileId = profileId;
  clearStatus();
  renderProfileList();
}

function cancelRenameProfile(profileId: string) {
  if (editingProfileId !== profileId) return;
  editingProfileId = null;
  clearStatus();
  renderProfileList();
}

async function saveProfileName(profileId: string) {
  const input = document.querySelector<HTMLInputElement>(`.profile-name-input[data-id="${CSS.escape(profileId)}"]`);
  const name = input?.value.trim() ?? "";
  if (!name) {
    setStatus("Please enter a configuration name.", true);
    input?.focus();
    return;
  }

  const resp = await send({
    type: "UPDATE_PROFILE",
    profileId,
    updates: { name, urlPattern: createUrlPattern(wiz.url), updatedAt: new Date().toISOString() },
  });
  if (!resp.ok) { setStatus(resp.error, true); return; }

  editingProfileId = null;
  setStatus("Configuration renamed.");
  await loadProfiles();
}

async function deleteSavedProfile(profileId: string) {
  const profile = siteProfiles.find((p) => p.id === profileId);
  if (!profile) return;
  if (!window.confirm(`Delete "${profile.name}"? This cannot be undone.`)) return;

  const resp = await send({ type: "DELETE_PROFILE", profileId });
  if (!resp.ok) { setStatus(resp.error, true); return; }

  if (editingProfileId === profileId) editingProfileId = null;
  setStatus("Configuration deleted.");
  await loadProfiles();
}

async function saveProfileAction(profileId: string, actionType: ActionPreset["type"]) {
  const resp = await send({
    type: "UPDATE_PROFILE",
    profileId,
    updates: {
      actionPreset: { type: actionType },
      urlPattern: createUrlPattern(wiz.url),
      updatedAt: new Date().toISOString(),
    },
  });
  if (!resp.ok) { setStatus(resp.error, true); return; }

  setStatus("Action updated.");
  await loadProfiles();
}

async function runProfile(profileId: string) {
  setStatus("Running...");
  const select = document.querySelector<HTMLSelectElement>(`.profile-action-select[data-id="${CSS.escape(profileId)}"]`);
  const actionPresetOverride = select ? { type: select.value as ActionPreset["type"] } : undefined;

  // Step 1: Run the recipe in background (handles status update, no transform/action)
  const recipeResp = await send({ type: "RUN_RECIPE_FOR_PROFILE", profileId, actionPresetOverride });
  if (!recipeResp.ok) { setStatus(recipeResp.error, true); return; }
  if (!("result" in recipeResp) || !("profile" in recipeResp)) return;

  const profile = recipeResp.profile as ExtractionProfile;
  const result = recipeResp.result as ExtractionResult;

  // Step 2: Run transform in sandbox (safe new Function via unsafe-eval iframe)
  let exportResult: ExportResult;
  if (profile.transform) {
    try {
      exportResult = await runTransformInSandbox(profile.transform, result.data);
    } catch (err) {
      setStatus(`Transform failed: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }
  } else {
    exportResult = { formatLabel: "JSON", content: JSON.stringify(result.data, null, 2), warnings: [] };
  }

  // Step 3: Apply action
  const actionPreset = actionPresetOverride ?? profile.actionPreset;
  const errors: string[] = [];
  let copied = false;
  let downloaded = false;

  if (actionPreset.type === "copy" || actionPreset.type === "copy_download") {
    try {
      await navigator.clipboard.writeText(exportResult.content);
      copied = true;
    } catch (err) {
      errors.push(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (actionPreset.type === "download" || actionPreset.type === "copy_download") {
    const dlResp = await send({ type: "DOWNLOAD_EXPORT", exportResult, profileId });
    if (dlResp.ok) {
      downloaded = true;
    } else if (!dlResp.ok) {
      errors.push(dlResp.error);
    }
  }

  if (errors.length > 0) {
    setStatus(`Run failed: ${errors[0]}`, true);
  } else {
    const parts = ([copied && "Copied", downloaded && "Downloaded"] as (string | false)[])
      .filter(Boolean)
      .join(" / ");
    setStatus(parts || "Done");
    await loadProfiles();
  }
}

// ── Codex Studio: Snapshot ─────────────────────────────────────────────────

async function ensureSnapshot(): Promise<string | null> {
  if (wiz.snapshot) return wiz.snapshot;
  const resp = await send({ type: "CREATE_SNAPSHOT" });
  if (!resp.ok) { setStatus(resp.error, true); return null; }
  if (!("snapshot" in resp)) return null;
  wiz.snapshot = resp.snapshot;
  wiz.url = resp.url;
  return wiz.snapshot;
}

// ── Codex Studio: Core extraction flow ────────────────────────────────────

async function onExtract() {
  clearStatus();
  wiz.intent = el<HTMLTextAreaElement>("cs-intent").value.trim();
  wiz.baseProfileId = el<HTMLSelectElement>("cs-base-config").value || null;
  await doExtractAndFormat();
}

async function doExtractAndFormat() {
  showScreen("extracting");
  resetProcessView("Preparing page snapshot");

  const snapshot = await ensureSnapshot();
  if (!snapshot) { showScreen("entry"); return; }
  appendProcessLog("stage", "Captured page snapshot");

  let intent = wiz.intent;
  let confirmedFields: string[] | undefined;
  const baseProfile = wiz.baseProfileId ? siteProfiles.find((profile) => profile.id === wiz.baseProfileId) : undefined;

  if (baseProfile && !intent) {
    intent = "Update this base configuration for the current page.";
    wiz.intent = intent;
    appendProcessLog("stage", `Using "${baseProfile.name}" as the base configuration`);
  } else if (baseProfile) {
    appendProcessLog("stage", `Using "${baseProfile.name}" as the base configuration`);
  } else if (!intent) {
    const ar = await send({ type: "ANALYZE_INTENT", domSnapshot: snapshot, url: wiz.url });
    if (!ar.ok || !("analysis" in ar)) {
      setStatus(ar.ok ? "Analysis failed" : ar.error, true);
      showScreen("entry");
      return;
    }
    confirmedFields = ar.analysis.suggestedFields.map((f) => f.name);
    intent = confirmedFields.join(", ");
    wiz.intent = intent;
    appendProcessLog("stage", "Auto-detected extraction intent");
  }

  let gr: { recipe: ExtractionRecipe };
  try {
    gr = await streamBackend<{ recipe: ExtractionRecipe }>("/generate-recipe/stream", {
      intent,
      domSnapshot: snapshot,
      url: wiz.url,
      confirmedFields,
      baseRecipe: baseProfile?.recipe,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    showScreen("entry");
    return;
  }

  wiz.recipe = gr.recipe;
  appendProcessLog("stage", "Running recipe in current page");
  const run = await send({ type: "RUN_RECIPE_PREVIEW", recipe: gr.recipe });
  if (!run.ok || !("result" in run)) {
    const message = run.ok ? "Recipe run failed" : run.error;
    appendProcessLog("error", message, true);
    setStatus(message, true);
    showScreen("entry");
    return;
  }
  wiz.result = run.result;
  appendProcessArtifact("Extraction result", wiz.result.data);

  await applyAutoFormat();
  renderResult();
  showScreen("result");
}

async function applyAutoFormat(hint = "") {
  if (!wiz.result) return;
  const outputRequest = hint || "auto";
  try {
    const fr = await streamBackend<{ transform: TransformSpec | null; exportResult: ExportResult }>("/transform/stream", {
      outputRequest,
      intent: wiz.intent || "Extract the main content",
      result: wiz.result,
    });
    wiz.transform = fr.transform;
    wiz.exportResult = fr.exportResult;
  } catch (error) {
    appendProcessLog("error", error instanceof Error ? error.message : String(error), true);
  }
}

function renderResult() {
  const er = wiz.exportResult;
  el("cs-format-label").textContent = er?.formatLabel ?? "JSON";
  el("cs-result-content").textContent = er?.content ?? JSON.stringify(wiz.result?.data, null, 2);
  el<HTMLTextAreaElement>("cs-result-feedback").value = "";
}

// ── Codex Studio: Refine ──────────────────────────────────────────────────

async function onRefine() {
  clearStatus();
  const feedback = el<HTMLTextAreaElement>("cs-result-feedback").value.trim();
  if (!feedback) { setStatus("Describe what you'd like to change.", true); return; }
  if (!wiz.recipe || !wiz.result) return;

  setBtnLoading("btn-refine", true);
  showScreen("extracting");
  resetProcessView("Preparing refinement");

  const snapshot = await ensureSnapshot();
  if (!snapshot) { showScreen("result"); setBtnLoading("btn-refine", false); return; }

  let rr: RefineStreamResult;
  try {
    rr = await streamBackend<RefineStreamResult>("/refine/stream", {
      feedback,
      intent: wiz.intent || "Extract the main content",
      currentRecipe: wiz.recipe,
      currentResult: wiz.result,
      domSnapshot: snapshot,
      url: wiz.url,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    showScreen("result");
    setBtnLoading("btn-refine", false);
    return;
  }

  wiz.recipe = rr.artifact.recipe;
  appendProcessLog("stage", "Running refined recipe in current page");
  const run = await send({ type: "RUN_RECIPE_PREVIEW", recipe: wiz.recipe });
  if (!run.ok || !("result" in run)) {
    const message = run.ok ? "Recipe run failed" : run.error;
    appendProcessLog("error", message, true);
    setStatus(message, true);
    showScreen("result");
    setBtnLoading("btn-refine", false);
    return;
  }
  wiz.result = run.result;
  appendProcessArtifact("Extraction result", wiz.result.data);

  if (rr.exportResult) {
    wiz.transform = rr.artifact.transform ?? null;
    wiz.exportResult = rr.exportResult;
  } else if (rr.artifact.transform) {
    appendProcessLog("stage", "Running refined transform preview");
    const tr = await send({ type: "RUN_TRANSFORM_PREVIEW", transform: rr.artifact.transform, data: wiz.result.data });
    if (tr.ok && "exportResult" in tr) {
      wiz.transform = rr.artifact.transform;
      wiz.exportResult = tr.exportResult;
      appendProcessArtifact("Formatted preview", tr.exportResult.content);
    } else {
      appendProcessLog("error", tr.ok ? "Transform preview failed" : tr.error, true);
      await applyAutoFormat();
    }
  } else {
    await applyAutoFormat();
  }

  renderResult();
  showScreen("result");
  setBtnLoading("btn-refine", false);
}

// ── Codex Studio: Save ────────────────────────────────────────────────────

function generateId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function onSaveConfig() {
  clearStatus();
  if (!wiz.recipe) { setStatus("No recipe to save.", true); return; }

  const name = el<HTMLInputElement>("cs-config-name").value.trim();
  if (!name) { setStatus("Please enter a configuration name.", true); return; }

  const now = new Date().toISOString();
  const baseProfile = wiz.baseProfileId ? siteProfiles.find((p) => p.id === wiz.baseProfileId) : undefined;

  const profile: ExtractionProfile = {
    id: generateId(),
    name,
    urlPattern: baseProfile?.urlPattern ?? createUrlPattern(wiz.url),
    intent: wiz.intent || "Extract the main content",
    recipe: wiz.recipe,
    transform: wiz.transform ?? undefined,
    outputDescription: wiz.exportResult?.formatLabel,
    actionPreset: baseProfile?.actionPreset ?? { type: "copy" },
    isDefault: false,
    status: "ok",
    lastRunAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const resp = await send({ type: "SAVE_PROFILE", profile });
  if (!resp.ok) { setStatus(resp.error, true); return; }

  setStatus("Configuration saved.");
  resetWizard();
  switchTab("quickrun");
  await loadProfiles();
}

function resetWizard() {
  wiz.baseProfileId = null;
  wiz.snapshot = "";
  wiz.recipe = null;
  wiz.result = null;
  wiz.transform = null;
  wiz.exportResult = null;
  wiz.intent = "";
  el<HTMLTextAreaElement>("cs-intent").value = "";
  el<HTMLSelectElement>("cs-base-config").value = "";
  showScreen("entry");
}

// ── Tab switching ──────────────────────────────────────────────────────────

function switchTab(tab: "codex" | "quickrun") {
  const isCodex = tab === "codex";
  el("panel-codex").classList.toggle("hidden", !isCodex);
  el("panel-quickrun").classList.toggle("hidden", isCodex);
  el("tab-codex").classList.toggle("active", isCodex);
  el("tab-quickrun").classList.toggle("active", !isCodex);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  switchTab("quickrun");
  showScreen("entry");
  await loadProfiles();

  el("tab-codex").addEventListener("click", () => switchTab("codex"));
  el("tab-quickrun").addEventListener("click", () => switchTab("quickrun"));
  el("btn-new-config").addEventListener("click", () => { resetWizard(); switchTab("codex"); });
  el("cs-base-config").addEventListener("change", () => {
    wiz.baseProfileId = el<HTMLSelectElement>("cs-base-config").value || null;
  });

  el("btn-extract").addEventListener("click", () => void onExtract());
  el("btn-start-over").addEventListener("click", () => resetWizard());

  el("btn-refine").addEventListener("click", () => void onRefine());
  el("btn-result-next").addEventListener("click", () => {
    el<HTMLInputElement>("cs-config-name").value = "";
    showScreen("save");
  });

  el("btn-save-back").addEventListener("click", () => showScreen("result"));
  el("btn-save-config").addEventListener("click", () => void onSaveConfig());
}

document.addEventListener("DOMContentLoaded", () => void init());
