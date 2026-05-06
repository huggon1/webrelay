import {
  createUrlPattern,
  type ActionPreset,
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

type WizardScreen = "entry" | "extracting" | "result" | "save" | "repair";

const SCREEN_TO_STEP: Record<WizardScreen, number> = {
  entry: 0,
  repair: 0,
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
  repairProfileId: null as string | null,
};

function showScreen(screen: WizardScreen) {
  wiz.screen = screen;
  const screens: WizardScreen[] = ["entry", "extracting", "result", "save", "repair"];
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
            ${failed
              ? `<button class="btn-repair btn-secondary btn-small" data-id="${escapeHtml(profile.id)}">Repair</button>`
              : `<button class="btn-run btn-primary btn-small" data-id="${escapeHtml(profile.id)}">Run</button>`}
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
  list.querySelectorAll<HTMLButtonElement>(".btn-repair").forEach((btn) => {
    btn.addEventListener("click", () => startRepair(btn.dataset.id!));
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
  const resp = await send({ type: "RUN_PROFILE", profileId, actionPresetOverride });
  if (!resp.ok) { setStatus(resp.error, true); return; }
  if (!("actionResult" in resp)) return;

  const ar = resp.actionResult as ActionRunResult;
  if (ar.errors.length > 0) {
    setStatus(`Run failed: ${ar.errors[0]}`, true);
  } else {
    const parts = ([ar.copied && "Copied", ar.downloaded && "Downloaded"] as (string | false)[])
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
  await doExtractAndFormat();
}

async function doExtractAndFormat() {
  showScreen("extracting");

  const snapshot = await ensureSnapshot();
  if (!snapshot) { showScreen("entry"); return; }

  let intent = wiz.intent;
  let confirmedFields: string[] | undefined;

  if (!intent) {
    const ar = await send({ type: "ANALYZE_INTENT", domSnapshot: snapshot, url: wiz.url });
    if (!ar.ok || !("analysis" in ar)) {
      setStatus(ar.ok ? "Analysis failed" : ar.error, true);
      showScreen("entry");
      return;
    }
    confirmedFields = ar.analysis.suggestedFields.map((f) => f.name);
    intent = confirmedFields.join(", ");
    wiz.intent = intent;
  }

  const gr = await send({
    type: "GENERATE_RECIPE",
    intent,
    domSnapshot: snapshot,
    url: wiz.url,
    confirmedFields,
  });

  if (!gr.ok || !("recipe" in gr) || !("result" in gr)) {
    setStatus(gr.ok ? "Recipe generation failed" : gr.error, true);
    showScreen("entry");
    return;
  }

  wiz.recipe = gr.recipe;
  wiz.result = gr.result;

  await applyAutoFormat();
  renderResult();
  showScreen("result");
}

async function applyAutoFormat(hint = "") {
  if (!wiz.result) return;
  const outputRequest = hint || "auto";
  const fr = await send({
    type: "GENERATE_TRANSFORM",
    outputRequest,
    intent: wiz.intent || "Extract the main content",
    result: wiz.result,
  });
  if (!fr.ok || !("transform" in fr)) return;
  wiz.transform = fr.transform;
  wiz.exportResult = fr.exportResult;
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

  const snapshot = await ensureSnapshot();
  if (!snapshot) { showScreen("result"); setBtnLoading("btn-refine", false); return; }

  const rr = await send({
    type: "REFINE_RECIPE",
    feedback,
    intent: wiz.intent || "Extract the main content",
    currentRecipe: wiz.recipe,
    currentResult: wiz.result,
    domSnapshot: snapshot,
    url: wiz.url,
  });

  if (!rr.ok || !("recipe" in rr)) {
    setStatus(rr.ok ? "Refinement failed" : rr.error, true);
    showScreen("result");
    setBtnLoading("btn-refine", false);
    return;
  }

  wiz.recipe = rr.recipe;
  wiz.result = rr.result;

  if ("transform" in rr && "exportResult" in rr) {
    wiz.transform = rr.transform;
    wiz.exportResult = rr.exportResult;
  } else {
    await applyAutoFormat();
  }

  renderResult();
  showScreen("result");
  setBtnLoading("btn-refine", false);
}

// ── Codex Studio: Repair ──────────────────────────────────────────────────

function startRepair(profileId: string) {
  const profile = siteProfiles.find((p) => p.id === profileId);
  if (!profile) return;
  wiz.repairProfileId = profileId;
  wiz.intent = profile.intent;
  el("cs-repair-name").textContent = profile.name;
  el("cs-repair-reason").textContent = "Last run returned empty or failed results.";
  el<HTMLTextAreaElement>("cs-repair-note").value = "";
  switchTab("codex");
  showScreen("repair");
}

async function onStartRepair() {
  clearStatus();
  if (!wiz.repairProfileId) return;
  const userNote = el<HTMLTextAreaElement>("cs-repair-note").value.trim() || undefined;
  showScreen("extracting");

  const snapshot = await ensureSnapshot();
  if (!snapshot) { showScreen("repair"); return; }

  const resp = await send({
    type: "REPAIR_RECIPE",
    profileId: wiz.repairProfileId,
    domSnapshot: snapshot,
    url: wiz.url,
    userNote,
  });

  if (!resp.ok || !("recipe" in resp) || !("result" in resp)) {
    setStatus(resp.ok ? "Repair failed" : resp.error, true);
    showScreen("repair");
    return;
  }

  wiz.recipe = resp.recipe;
  wiz.result = resp.result;

  await applyAutoFormat();
  renderResult();
  showScreen("result");
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
  const isRepair = !!wiz.repairProfileId;
  const existing = isRepair ? siteProfiles.find((p) => p.id === wiz.repairProfileId) : undefined;

  const profile: ExtractionProfile = {
    id: wiz.repairProfileId ?? generateId(),
    name,
    urlPattern: existing?.urlPattern ?? createUrlPattern(wiz.url),
    intent: wiz.intent || "Extract the main content",
    recipe: wiz.recipe,
    transform: wiz.transform ?? undefined,
    outputDescription: wiz.exportResult?.formatLabel,
    actionPreset: existing?.actionPreset ?? { type: "copy" },
    isDefault: existing?.isDefault ?? false,
    status: "ok",
    lastRunAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };

  const resp = await send({ type: "SAVE_PROFILE", profile });
  if (!resp.ok) { setStatus(resp.error, true); return; }

  setStatus(isRepair ? "Configuration repaired and saved." : "Configuration saved.");
  resetWizard();
  switchTab("quickrun");
  await loadProfiles();
}

function resetWizard() {
  wiz.repairProfileId = null;
  wiz.snapshot = "";
  wiz.recipe = null;
  wiz.result = null;
  wiz.transform = null;
  wiz.exportResult = null;
  wiz.intent = "";
  el<HTMLTextAreaElement>("cs-intent").value = "";
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
  el("btn-new-config").addEventListener("click", () => { switchTab("codex"); showScreen("entry"); });

  el("btn-extract").addEventListener("click", () => void onExtract());
  el("btn-start-over").addEventListener("click", () => resetWizard());

  el("btn-refine").addEventListener("click", () => void onRefine());
  el("btn-result-next").addEventListener("click", () => {
    el<HTMLInputElement>("cs-config-name").value = "";
    showScreen("save");
  });

  el("btn-save-back").addEventListener("click", () => showScreen("result"));
  el("btn-save-config").addEventListener("click", () => void onSaveConfig());

  el("btn-repair-back").addEventListener("click", () => { wiz.repairProfileId = null; switchTab("quickrun"); });
  el("btn-repair-start").addEventListener("click", () => void onStartRepair());
}

document.addEventListener("DOMContentLoaded", () => void init());
