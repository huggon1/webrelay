import {
  createUrlPattern,
  type ExecutionDebug,
  type ExtractionProfile,
  type ExtractionRecipe,
  type ExtractionResult,
} from "@extractor/shared";
import type { BackgroundRequest, BackgroundResponse } from "./messages.js";

const urlEl = document.querySelector<HTMLParagraphElement>("#current-url")!;
const intentEl = document.querySelector<HTMLTextAreaElement>("#intent")!;
const generateBtn = document.querySelector<HTMLButtonElement>("#generate")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;
const repairBtn = document.querySelector<HTMLButtonElement>("#repair")!;
const profilesEl = document.querySelector<HTMLSelectElement>("#profiles")!;
const runProfileBtn = document.querySelector<HTMLButtonElement>("#run-profile")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const resultEl = document.querySelector<HTMLPreElement>("#result")!;
const debugEl = document.querySelector<HTMLPreElement>("#debug")!;

let currentUrl = "";
let currentTitle = "";
let currentRecipe: ExtractionRecipe | null = null;
let currentResult: ExtractionResult | null = null;
let currentSnapshot = "";
let profiles: ExtractionProfile[] = [];

function setStatus(message: string) {
  statusEl.textContent = message;
}

function showJson(target: HTMLElement, value: unknown) {
  target.textContent = value === undefined ? "" : JSON.stringify(value, null, 2);
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

function renderProfiles() {
  profilesEl.innerHTML = "";
  if (profiles.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No matching profiles";
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
  showJson(debugEl, response.result.debug);
  repairBtn.disabled = response.result.ok;
  return response.result;
}

function profileFromCurrentRecipe(): ExtractionProfile {
  if (!currentRecipe) throw new Error("No recipe to save.");
  const now = new Date().toISOString();
  const existing = selectedProfile();
  return {
    id: existing?.id || crypto.randomUUID(),
    name: existing?.name || currentTitle || new URL(currentUrl).hostname,
    urlPattern: existing?.urlPattern || createUrlPattern(currentUrl),
    intent: intentEl.value.trim(),
    recipe: currentRecipe,
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
    saveBtn.disabled = false;
    setStatus("Recipe generated. Running it on the page...");
    const result = await runRecipe(currentRecipe);
    setStatus(result.ok ? "Extraction succeeded." : "Extraction needs review or repair.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

runProfileBtn.addEventListener("click", async () => {
  try {
    const profile = selectedProfile();
    if (!profile) throw new Error("Select a profile first.");
    currentRecipe = profile.recipe;
    intentEl.value = profile.intent;
    setStatus("Running saved profile...");
    const result = await runRecipe(profile.recipe);
    setStatus(result.ok ? "Profile ran successfully." : "Profile failed; repair is available.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

saveBtn.addEventListener("click", async () => {
  try {
    const profile = profileFromCurrentRecipe();
    const response = await requireOk(sendMessage({ type: "SAVE_PROFILE", profile }));
    if (!("profile" in response)) throw new Error("Save response was incomplete.");
    setStatus("Profile saved.");
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
