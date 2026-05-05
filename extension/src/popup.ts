import {
  createUrlPattern,
  exportResultSchema,
  type ActionPreset,
  type ExportResult,
  type ExecutionDebug,
  type ExtractionProfile,
  type ExtractionRecipe,
  type ExtractionResult,
  type TransformSpec,
} from "@extractor/shared";
import type { BackgroundRequest, BackgroundResponse } from "./messages.js";

const urlEl = document.querySelector<HTMLParagraphElement>("#current-url")!;
const intentEl = document.querySelector<HTMLTextAreaElement>("#intent")!;
const refinementEl = document.querySelector<HTMLTextAreaElement>("#refinement")!;
const generateBtn = document.querySelector<HTMLButtonElement>("#generate")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;
const repairBtn = document.querySelector<HTMLButtonElement>("#repair")!;
const refineBtn = document.querySelector<HTMLButtonElement>("#refine")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
const copyPreviewBtn = document.querySelector<HTMLButtonElement>("#copy-preview")!;
const copyOutputBtn = document.querySelector<HTMLButtonElement>("#copy-output")!;
const profilesEl = document.querySelector<HTMLSelectElement>("#profiles")!;
const actionPresetEl = document.querySelector<HTMLSelectElement>("#action-preset")!;
const runProfileBtn = document.querySelector<HTMLButtonElement>("#run-profile")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const resultEl = document.querySelector<HTMLPreElement>("#result")!;
const exportResultEl = document.querySelector<HTMLPreElement>("#export-result")!;
const debugEl = document.querySelector<HTMLPreElement>("#debug")!;

let currentUrl = "";
let currentTitle = "";
let currentRecipe: ExtractionRecipe | null = null;
let currentTransform: TransformSpec | null = null;
let currentResult: ExtractionResult | null = null;
let currentExport: ExportResult | null = null;
let currentSnapshot = "";
let profiles: ExtractionProfile[] = [];
let sandboxFrame: HTMLIFrameElement | null = null;

function setStatus(message: string) {
  statusEl.textContent = message;
}

function showJson(target: HTMLElement, value: unknown) {
  target.textContent = value === undefined ? "" : JSON.stringify(value, null, 2);
}

function showExport(value: ExportResult | null) {
  currentExport = value;
  if (!value) {
    exportResultEl.textContent = "";
    copyOutputBtn.disabled = true;
    return;
  }
  const warningText = value.warnings.length ? `Warnings:\n${value.warnings.join("\n")}\n\n` : "";
  exportResultEl.textContent = `${warningText}${value.content}`;
  copyOutputBtn.disabled = false;
}

function sendMessage(message: BackgroundRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(message);
}

async function requireOk<T extends BackgroundResponse>(promise: Promise<T>) {
  const response = await promise;
  if (!response.ok) throw new Error(response.error);
  return response;
}

function selectedProfile() {
  return profiles.find((profile) => profile.id === profilesEl.value) || null;
}

function selectedActionPreset(): ActionPreset {
  if (
    actionPresetEl.value === "copy" ||
    actionPresetEl.value === "download" ||
    actionPresetEl.value === "copy_download"
  ) {
    return { type: actionPresetEl.value };
  }
  return { type: "copy" };
}

function syncActionPresetFromSelectedProfile() {
  const profile = selectedProfile();
  actionPresetEl.value = profile?.actionPreset.type || "copy";
}

function actionSummary(actionResult: { copied: boolean; downloaded: boolean; errors: string[] }) {
  const done = [
    actionResult.copied ? "copied" : "",
    actionResult.downloaded ? "downloaded" : "",
  ].filter(Boolean);
  const prefix = done.length ? ` Action ${done.join(" and ")}.` : "";
  return actionResult.errors.length ? `${prefix} ${actionResult.errors.join(" ")}` : prefix;
}

function wantsFormattedOutput() {
  const text = `${intentEl.value}\n${refinementEl.value}`.toLowerCase();
  return /\b(markdown|md|csv|json|html|xml|yaml|table)\b|格式|输出|匯出|导出/.test(text);
}

function defaultOutputRequest() {
  const feedback = refinementEl.value.trim();
  if (feedback) return feedback;
  return intentEl.value.trim() || "Create a readable local preview in the most useful format.";
}

async function copyText(text: string, successMessage: string) {
  await navigator.clipboard.writeText(text);
  setStatus(successMessage);
}

async function ensureCurrentExport() {
  if (currentExport) return currentExport;
  if (!currentResult) throw new Error("Capture a preview first.");
  return generateCurrentExport();
}

function renderProfiles() {
  profilesEl.innerHTML = "";
  if (profiles.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No matching configurations";
    profilesEl.append(option);
    runProfileBtn.disabled = true;
    return;
  }

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} v${profile.version}`;
    profilesEl.append(option);
  }
  runProfileBtn.disabled = false;
  syncActionPresetFromSelectedProfile();
}

async function refreshProfiles() {
  const response = await requireOk(sendMessage({ type: "LIST_PROFILES" }));
  if ("profiles" in response) {
    profiles = response.profiles;
    renderProfiles();
  }
}

async function createSnapshot() {
  const response = await requireOk(sendMessage({ type: "CREATE_SNAPSHOT" }));
  if (!("snapshot" in response)) throw new Error("Snapshot response was incomplete.");
  currentSnapshot = response.snapshot;
  return currentSnapshot;
}

async function runRecipe(recipe: ExtractionRecipe) {
  const response = await requireOk(sendMessage({ type: "RUN_RECIPE", recipe }));
  if (!("result" in response)) throw new Error("Run response was incomplete.");
  currentResult = response.result;
  showJson(resultEl, response.result.data);
  copyPreviewBtn.disabled = false;
  showJson(debugEl, response.result.debug);
  repairBtn.disabled = response.result.ok;
  refineBtn.disabled = false;
  exportBtn.disabled = false;
  if (currentTransform) {
    await runCurrentTransform();
  } else {
    showExport(fallbackExportResult(response.result.data));
  }
  return response.result;
}

async function runCurrentTransform() {
  if (!currentTransform || !currentResult) return null;
  const exportResult = await runTransformInSandbox(currentTransform, currentResult.data);
  showExport(exportResult);
  return exportResult;
}

async function runTransformInSandbox(transform: TransformSpec, data: unknown) {
  const frame = await getSandboxFrame();
  const id = crypto.randomUUID();
  return new Promise<ExportResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Transform sandbox timed out."));
    }, 1000);

    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow || event.data?.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (event.data.ok) {
        resolve(exportResultSchema.parse(event.data.exportResult));
        return;
      }
      reject(new Error(event.data.error || "Transform sandbox failed."));
    }

    window.addEventListener("message", onMessage);
    frame.contentWindow?.postMessage({ id, type: "RUN_TRANSFORM", transform, data }, "*");
  });
}

async function getSandboxFrame() {
  if (sandboxFrame?.contentWindow) return sandboxFrame;
  sandboxFrame = document.createElement("iframe");
  sandboxFrame.src = chrome.runtime.getURL("sandbox.html");
  sandboxFrame.style.display = "none";
  document.body.append(sandboxFrame);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Transform sandbox failed to load.")), 1000);
    sandboxFrame!.addEventListener(
      "load",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
  return sandboxFrame;
}

async function generateCurrentExport() {
  if (!currentResult) throw new Error("Capture a preview first.");
  setStatus("Generating export transform...");
  const response = await requireOk(
    sendMessage({
      type: "TRANSFORM_RESULT",
      intent: intentEl.value.trim() || "Extract useful page content",
      outputRequest: defaultOutputRequest(),
      result: currentResult,
    }),
  );
  if (!("exportResult" in response)) throw new Error("Export response was incomplete.");
  currentTransform = response.transform;
  showExport(response.exportResult);
  saveBtn.disabled = !currentRecipe;
  setStatus(response.exportResult.warnings.length ? "Export preview created with warnings." : "Export ready.");
  return response.exportResult;
}

async function applySelectedActionFromPopup(profile?: ExtractionProfile) {
  const exportResult = await ensureCurrentExport();
  const actionPreset = selectedActionPreset();
  let copied = false;
  const errors: string[] = [];

  if (actionPreset.type === "copy" || actionPreset.type === "copy_download") {
    try {
      await navigator.clipboard.writeText(exportResult.content);
      copied = true;
    } catch (error) {
      errors.push(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let downloaded = false;
  if (actionPreset.type === "download" || actionPreset.type === "copy_download") {
    const response = await requireOk(
      sendMessage({ type: "APPLY_ACTION", exportResult, actionPreset: { type: "download" }, profile }),
    );
    if (!("actionResult" in response)) throw new Error("Download response was incomplete.");
    downloaded = response.actionResult.downloaded;
    errors.push(...response.actionResult.errors);
  }

  return { copied, downloaded, errors };
}

function fallbackExportResult(data: unknown): ExportResult {
  return {
    formatLabel: "JSON",
    content: JSON.stringify(data, null, 2),
    warnings: [],
  };
}

async function markProfileUsed(profile: ExtractionProfile, actionPreset: ActionPreset) {
  await requireOk(sendMessage({ type: "MARK_PROFILE_USED", profile, actionPreset }));
}

function profileFromCurrentRecipe(): ExtractionProfile {
  if (!currentRecipe) throw new Error("No recipe to save.");
  if (wantsFormattedOutput() && !currentTransform) {
    throw new Error("Generate the export format before saving this formatted configuration.");
  }
  const now = new Date().toISOString();
  const existing = selectedProfile();
  return {
    id: existing?.id || crypto.randomUUID(),
    name: existing?.name || currentTitle || new URL(currentUrl).hostname,
    urlPattern: existing?.urlPattern || createUrlPattern(currentUrl),
    intent: intentEl.value.trim(),
    recipe: currentRecipe,
    transform: currentTransform || undefined,
    outputDescription: currentTransform?.outputDescription,
    actionPreset: selectedActionPreset(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    version: existing ? existing.version + 1 : 1,
  };
}

generateBtn.addEventListener("click", async () => {
  try {
    const intent = intentEl.value.trim();
    if (!intent) throw new Error("Enter an extraction intent first.");
    setStatus("Creating DOM snapshot...");
    const domSnapshot = await createSnapshot();
    setStatus("Generating recipe...");
    const response = await requireOk(
      sendMessage({ type: "GENERATE_RECIPE", intent, domSnapshot, url: currentUrl }),
    );
    if (!("recipe" in response)) throw new Error("Generate response was incomplete.");
    currentRecipe = response.recipe;
    currentTransform = null;
    saveBtn.disabled = false;
    setStatus("Capture recipe generated. Running preview...");
    const result = await runRecipe(currentRecipe);
    if (result.ok && wantsFormattedOutput()) {
      await generateCurrentExport();
      setStatus("Preview and formatted output are ready. Save the configuration to keep both.");
      return;
    }
    setStatus(result.ok ? "Preview captured. Refine or export it." : "Preview needs review or repair.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

runProfileBtn.addEventListener("click", async () => {
  try {
    const profile = selectedProfile();
    if (!profile) throw new Error("Select a profile first.");
    currentRecipe = profile.recipe;
    currentTransform = profile.transform || null;
    intentEl.value = profile.intent;
    setStatus("Running saved configuration...");
    const response = await requireOk(sendMessage({ type: "RUN_RECIPE", recipe: profile.recipe }));
    if (!("result" in response)) throw new Error("Profile run response was incomplete.");
    currentResult = response.result;
    showJson(resultEl, response.result.data);
    copyPreviewBtn.disabled = false;
    showJson(debugEl, response.result.debug);
    if (profile.transform) {
      try {
        currentExport = await runTransformInSandbox(profile.transform, response.result.data);
      } catch (error) {
        currentExport = {
          ...fallbackExportResult(response.result.data),
          warnings: [`Saved output transform failed: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    } else {
      currentExport = fallbackExportResult(response.result.data);
    }
    showExport(currentExport);
    repairBtn.disabled = response.result.ok;
    refineBtn.disabled = false;
    exportBtn.disabled = false;
    const actionResult = await applySelectedActionFromPopup(profile);
    const actionText = actionSummary(actionResult);
    if (response.result.ok && actionResult.errors.length === 0) {
      await markProfileUsed(profile, selectedActionPreset());
    }
    setStatus(
      response.result.ok
        ? `Configuration ran successfully.${actionText}`
        : `Configuration failed; repair is available.${actionText}`,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

saveBtn.addEventListener("click", async () => {
  try {
    if (wantsFormattedOutput() && currentResult && !currentTransform) {
      await generateCurrentExport();
    }
    const profile = profileFromCurrentRecipe();
    const response = await requireOk(sendMessage({ type: "SAVE_PROFILE", profile }));
    if (!("profile" in response)) throw new Error("Save response was incomplete.");
    setStatus("Configuration saved.");
    await refreshProfiles();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

repairBtn.addEventListener("click", async () => {
  try {
    if (!currentRecipe || !currentResult) throw new Error("Run a failing recipe first.");
    const intent = intentEl.value.trim();
    if (!intent) throw new Error("Intent is required for repair.");
    setStatus("Creating repair snapshot...");
    const domSnapshot = await createSnapshot();
    const failureReason =
      currentResult.debug.errors.map((error) => error.message).join("; ") ||
      "Extraction returned empty or low-quality data.";
    setStatus("Repairing recipe...");
    const response = await requireOk(
      sendMessage({
        type: "REPAIR_RECIPE",
        intent,
        domSnapshot,
        url: currentUrl,
        oldRecipe: currentRecipe,
        debug: currentResult.debug as ExecutionDebug,
        failureReason,
      }),
    );
    if (!("recipe" in response)) throw new Error("Repair response was incomplete.");
    currentRecipe = response.recipe;
    saveBtn.disabled = false;
    const result = await runRecipe(currentRecipe);
    setStatus(result.ok ? "Repair succeeded. Save the profile to keep it." : "Repair ran but still has issues.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

exportBtn.addEventListener("click", async () => {
  try {
    await generateCurrentExport();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

refineBtn.addEventListener("click", async () => {
  try {
    if (!currentRecipe || !currentResult) throw new Error("Capture a preview first.");
    const feedback = refinementEl.value.trim();
    if (!feedback) throw new Error("Enter refinement or export feedback first.");
    setStatus("Creating refinement snapshot...");
    const domSnapshot = await createSnapshot();
    setStatus("Refining artifact...");
    const response = await requireOk(
      sendMessage({
        type: "REFINE_ARTIFACT",
        intent: intentEl.value.trim() || "Extract useful page content",
        feedback,
        domSnapshot,
        url: currentUrl,
        currentRecipe,
        currentResult,
      }),
    );
    if (!("artifact" in response)) throw new Error("Refine response was incomplete.");
    currentRecipe = response.artifact.recipe;
    currentTransform = response.artifact.transform || currentTransform;
    saveBtn.disabled = false;
    if (response.exportResult) {
      showExport(response.exportResult);
      setStatus("Refinement produced a preview with warnings.");
      return;
    }
    const result = await runRecipe(currentRecipe);
    setStatus(result.ok ? "Refinement applied. Review the updated preview." : "Refinement ran but still has issues.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

copyPreviewBtn.addEventListener("click", async () => {
  try {
    if (!currentResult) throw new Error("Capture a preview first.");
    await copyText(JSON.stringify(currentResult.data, null, 2), "Preview copied.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

copyOutputBtn.addEventListener("click", async () => {
  try {
    if (!currentExport) throw new Error("Create an export first.");
    await copyText(currentExport.content, "Output copied.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

profilesEl.addEventListener("change", syncActionPresetFromSelectedProfile);

async function init() {
  try {
    const response = await requireOk(sendMessage({ type: "GET_ACTIVE_TAB" }));
    if (!("tab" in response)) throw new Error("Active tab response was incomplete.");
    currentUrl = response.tab.url;
    currentTitle = response.tab.title;
    urlEl.textContent = currentUrl;
    await refreshProfiles();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

void init();
