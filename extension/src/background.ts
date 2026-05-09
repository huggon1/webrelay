import {
  actionPresetSchema,
  createUrlPattern,
  extractionArtifactSchema,
  extractionProfileSchema,
  extractionRecipeSchema,
  lastUsedStateSchema,
  matchesUrlPattern,
  scriptConfigSchema,
  type ActionPreset,
  type CodexProgressEvent,
  type ExtractionArtifact,
  type ExtractionProfile,
  type ExtractionResult,
} from "@extractor/shared";
import type {
  ActionRunResult,
  BackgroundRequest,
  BackgroundResponse,
  ContentRequest,
  ContentResponse,
  GenerateArtifactResult,
  OffscreenResponse,
  ProfileRunResult,
  StudioJob,
  ToastVariant,
} from "./messages.js";

const PROFILES_KEY = "profilesV1";
const LAST_USED_BY_SITE_KEY = "lastUsedBySiteV1";
const STUDIO_JOB_KEY = "studioJobV1";
const BACKEND_URL = "http://localhost:8787";
const OFFSCREEN_COPY_MESSAGE = "OFFSCREEN_COPY";
const OFFSCREEN_RUN_SCRIPT_MESSAGE = "OFFSCREEN_RUN_SCRIPT";

let activeStudioAbortController: AbortController | null = null;
let activeStudioJobId: string | null = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page tab found.");
  return { id: tab.id, url: tab.url, title: tab.title || tab.url };
}

function ensureInjectableTab(urlValue: string) {
  const url = new URL(urlValue);
  if (!["http:", "https:", "file:"].includes(url.protocol)) {
    throw new Error("WebRelay can only inspect http, https, and local file pages.");
  }
  if (url.hostname === "chromewebstore.google.com") {
    throw new Error("Chrome does not allow extensions to inspect the Chrome Web Store.");
  }
}

function siteIdForUrl(urlValue: string) {
  const url = new URL(urlValue);
  return url.protocol === "file:" ? "file://" : url.hostname;
}

function isMissingContentScriptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Could not establish connection") || message.includes("Receiving end does not exist");
}

async function sendToContent(tabId: number, message: ContentRequest): Promise<ContentResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function showToast(tabId: number, tabUrl: string, message: string, variant: ToastVariant) {
  try {
    ensureInjectableTab(tabUrl);
    await sendToContent(tabId, { type: "SHOW_TOAST", message, variant });
  } catch {
    // Toast is best effort. The popup still reports errors when visible.
  }
}

async function getProfiles(): Promise<ExtractionProfile[]> {
  const data = await chrome.storage.local.get(PROFILES_KEY);
  const raw = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  const profiles = raw
    .map((profile) => extractionProfileSchema.safeParse(profile))
    .filter((result) => result.success)
    .map((result) => result.data);
  if (JSON.stringify(profiles) !== JSON.stringify(raw)) {
    await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }
  return profiles;
}

async function saveProfile(profile: ExtractionProfile) {
  const parsed = extractionProfileSchema.parse(profile);
  const existing = await getProfiles();
  await chrome.storage.local.set({
    [PROFILES_KEY]: [parsed, ...existing.filter((candidate) => candidate.id !== parsed.id)],
  });
  return parsed;
}

async function updateProfile(profileId: string, updates: Partial<ExtractionProfile>) {
  const profiles = await getProfiles();
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index === -1) throw new Error("Profile not found.");
  const merged = extractionProfileSchema.parse({ ...profiles[index], ...updates, id: profileId });
  profiles[index] = merged;
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  return merged;
}

async function deleteProfile(profileId: string) {
  const profiles = await getProfiles();
  await chrome.storage.local.set({
    [PROFILES_KEY]: profiles.filter((profile) => profile.id !== profileId),
  });
}

async function updateLastUsed(profile: ExtractionProfile, actionPreset: ActionPreset, urlValue: string) {
  const data = await chrome.storage.local.get(LAST_USED_BY_SITE_KEY);
  const existing =
    data[LAST_USED_BY_SITE_KEY] && typeof data[LAST_USED_BY_SITE_KEY] === "object" && !Array.isArray(data[LAST_USED_BY_SITE_KEY])
      ? data[LAST_USED_BY_SITE_KEY]
      : {};
  const state = lastUsedStateSchema.parse({
    siteId: siteIdForUrl(urlValue),
    profileId: profile.id,
    urlPattern: createUrlPattern(urlValue),
    lastRunAt: new Date().toISOString(),
    lastActionPreset: actionPreset,
  });
  await chrome.storage.local.set({
    [LAST_USED_BY_SITE_KEY]: { ...existing, [state.siteId]: state },
  });
}

async function getLastUsedProfileForSite(urlValue: string) {
  const data = await chrome.storage.local.get(LAST_USED_BY_SITE_KEY);
  const map = data[LAST_USED_BY_SITE_KEY] ?? {};
  const state = map[siteIdForUrl(urlValue)];
  if (!state?.profileId) return null;
  const profiles = await getProfiles();
  return profiles.find((profile) => profile.id === state.profileId && matchesUrlPattern(profile.urlPattern, urlValue)) ?? null;
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [documentUrl],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.IFRAME_SCRIPTING],
    justification: "Copy extraction output and run saved string transforms in a sandbox.",
  });
}

async function runScript(code: string, input: string) {
  const parsed = scriptConfigSchema.parse({ version: 1, code });
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    type: OFFSCREEN_RUN_SCRIPT_MESSAGE,
    id: crypto.randomUUID(),
    code: parsed.code,
    input,
  })) as OffscreenResponse | undefined;
  if (!response) {
    throw new Error("Script failed.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (!("output" in response)) {
    throw new Error("Script failed.");
  }
  return response.output;
}

async function copyContent(content: string) {
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    type: OFFSCREEN_COPY_MESSAGE,
    content,
  })) as OffscreenResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || "Clipboard write failed.");
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim();
}

async function downloadContent(content: string, profile: ExtractionProfile) {
  const baseName = sanitizeFilenamePart(profile.name) || "webrelay-export";
  const date = new Date().toISOString().slice(0, 10);
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({
    url,
    filename: `${baseName}-${date}.md`,
    saveAs: false,
  });
}

async function applyAction(content: string, actionPreset: ActionPreset, profile: ExtractionProfile): Promise<ActionRunResult> {
  const parsed = actionPresetSchema.parse(actionPreset);
  const result: ActionRunResult = { copied: false, downloaded: false, errors: [] };

  if (parsed.type === "copy" || parsed.type === "copy_download") {
    try {
      await copyContent(content);
      result.copied = true;
    } catch (error) {
      result.errors.push(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (parsed.type === "download" || parsed.type === "copy_download") {
    try {
      await downloadContent(content, profile);
      result.downloaded = true;
    } catch (error) {
      result.errors.push(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

async function runRecipeOnTab(tab: { id: number; url: string }, recipe: unknown) {
  ensureInjectableTab(tab.url);
  const contentResponse = await sendToContent(tab.id, {
    type: "RUN_RECIPE",
    recipe: extractionRecipeSchema.parse(recipe),
  });
  if (!contentResponse.ok) throw new Error(contentResponse.error);
  if (!("result" in contentResponse)) throw new Error("Recipe response was incomplete.");
  return { tab, result: contentResponse.result };
}

async function runRecipeOnActiveTab(recipe: unknown) {
  return runRecipeOnTab(await getActiveTab(), recipe);
}

async function createSnapshotOnActiveTab() {
  const tab = await getActiveTab();
  ensureInjectableTab(tab.url);
  const contentResponse = await sendToContent(tab.id, { type: "CREATE_SNAPSHOT" });
  if (!contentResponse.ok) throw new Error(contentResponse.error);
  if (!("snapshot" in contentResponse)) throw new Error("Snapshot response was incomplete.");
  return { snapshot: contentResponse.snapshot, url: contentResponse.url, tabId: tab.id };
}

function shouldMarkFailed(result: ExtractionResult) {
  return !result.ok || (result.debug.mode === "list" && result.debug.rootMatchCount === 0);
}

async function runProfile(profileId: string, actionPresetOverride?: ActionPreset): Promise<ProfileRunResult> {
  const tab = await getActiveTab();
  ensureInjectableTab(tab.url);
  const profiles = await getProfiles();
  const profile = profiles.find((candidate) => candidate.id === profileId && matchesUrlPattern(candidate.urlPattern, tab.url));
  if (!profile) throw new Error("No matching saved configuration was found.");

  const { result } = await runRecipeOnActiveTab(profile.recipe);
  const scriptInput = JSON.stringify(result.data, null, 2);
  const output = await runScript(profile.script.code, scriptInput);
  const actionPreset = actionPresetOverride ? actionPresetSchema.parse(actionPresetOverride) : profile.actionPreset;
  const actionResult = await applyAction(output, actionPreset, profile);

  const now = new Date().toISOString();
  const updates = shouldMarkFailed(result)
    ? { status: "possibly_failed" as const, lastRunAt: now, updatedAt: now }
    : { status: "ok" as const, actionPreset, lastRunAt: now, updatedAt: now };
  const updatedProfile = await updateProfile(profile.id, updates);
  if (!shouldMarkFailed(result)) {
    await updateLastUsed(updatedProfile, actionPreset, tab.url);
  }

  return { profile: updatedProfile, extraction: result, scriptInput, output, actionResult };
}

async function runProfilePreview(profile: ExtractionProfile) {
  const parsed = extractionProfileSchema.parse(profile);
  const { result } = await runRecipeOnActiveTab(parsed.recipe);
  const scriptInput = JSON.stringify(result.data, null, 2);
  const output = await runScript(parsed.script.code, scriptInput);
  return { extraction: result, scriptInput, output };
}

async function runProfilePreviewOnTab(profile: ExtractionProfile, tab: { id: number; url: string }) {
  const parsed = extractionProfileSchema.parse(profile);
  const { result } = await runRecipeOnTab(tab, parsed.recipe);
  const scriptInput = JSON.stringify(result.data, null, 2);
  const output = await runScript(parsed.script.code, scriptInput);
  return { extraction: result, scriptInput, output };
}

async function getStudioJob(): Promise<StudioJob | null> {
  const data = await chrome.storage.local.get(STUDIO_JOB_KEY);
  const raw = data[STUDIO_JOB_KEY];
  return raw && typeof raw === "object" ? (raw as StudioJob) : null;
}

async function setStudioJob(job: StudioJob | null) {
  if (!job) {
    await chrome.storage.local.remove(STUDIO_JOB_KEY);
    return;
  }
  await chrome.storage.local.set({ [STUDIO_JOB_KEY]: job });
}

async function updateStudioJob(jobId: string, update: (job: StudioJob) => StudioJob | null) {
  const current = await getStudioJob();
  if (!current || current.id !== jobId) return null;
  const updated = update(current);
  if (!updated) return current;
  await setStudioJob({ ...updated, updatedAt: new Date().toISOString() });
  return updated;
}

function appendStudioEvent(job: StudioJob, event: CodexProgressEvent): StudioJob {
  return { ...job, events: [...job.events, event] };
}

function buildStudioCandidateProfile(artifact: ExtractionArtifact, baseProfile: ExtractionProfile | undefined, urlValue: string) {
  const now = new Date().toISOString();
  return extractionProfileSchema.parse({
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "Generated candidate",
    urlPattern: baseProfile?.urlPattern ?? createUrlPattern(urlValue),
    recipe: artifact.recipe,
    script: artifact.script,
    actionPreset: baseProfile?.actionPreset ?? { type: "copy" },
    status: "ok",
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

async function streamBackendArtifact(
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: CodexProgressEvent) => Promise<void>,
): Promise<GenerateArtifactResult> {
  const response = await fetch(`${BACKEND_URL}/generate-artifact/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Backend stream failed: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: GenerateArtifactResult | undefined;

  const consumeChunk = async (chunk: string) => {
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
      await onEvent(event);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") doneResult = event.result as GenerateArtifactResult;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await consumeChunk(decoder.decode(value, { stream: true }));
  }
  await consumeChunk(decoder.decode());

  if (doneResult === undefined) throw new Error("Backend stream ended without a final result.");
  return doneResult;
}

async function runStudioJob(job: StudioJob, abortController: AbortController) {
  try {
    const result = await streamBackendArtifact(job.request, abortController.signal, async (event) => {
      await updateStudioJob(job.id, (current) => appendStudioEvent(current, event));
    });
    if (abortController.signal.aborted) return;

    const artifact = extractionArtifactSchema.parse(result.artifact);
    const candidateProfile = buildStudioCandidateProfile(artifact, job.request.baseProfile, job.request.url);
    await updateStudioJob(job.id, (current) =>
      appendStudioEvent(
        {
          ...current,
          artifact,
          outputDescription: artifact.outputDescription,
          candidateProfile,
        },
        { type: "stage", message: "Running generated profile through the shared preview runner" },
      ),
    );

    const preview = await runProfilePreviewOnTab(candidateProfile, { id: job.tabId, url: job.tabUrl });
    await updateStudioJob(job.id, (current) => ({
      ...appendStudioEvent(appendStudioEvent(current, { type: "artifact", artifactType: "result", label: "Script input", content: preview.scriptInput }), {
        type: "artifact",
        artifactType: "result",
        label: "Preview output",
        content: preview.output,
      }),
      status: "done",
      artifact,
      outputDescription: artifact.outputDescription,
      candidateProfile,
      preview,
    }));
  } catch (error) {
    const isAbort = abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    await updateStudioJob(job.id, (current) => {
      if (current.status === "cancelled" || isAbort) return current;
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...appendStudioEvent(current, { type: "error", message }),
        status: "error",
        error: message,
      };
    });
  } finally {
    if (activeStudioJobId === job.id) {
      activeStudioAbortController = null;
      activeStudioJobId = null;
    }
  }
}

async function startStudioGenerate(message: Extract<BackgroundRequest, { type: "START_STUDIO_GENERATE" }>) {
  const existing = await getStudioJob();
  if (existing?.status === "running") return existing;

  const now = new Date().toISOString();
  const job: StudioJob = {
    id: `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "running",
    request: message.request,
    tabId: message.tabId,
    tabUrl: message.tabUrl,
    events: [{ type: "stage", message: "Starting Codex Studio generation" }],
    createdAt: now,
    updatedAt: now,
  };
  await setStudioJob(job);

  const abortController = new AbortController();
  activeStudioAbortController = abortController;
  activeStudioJobId = job.id;
  void runStudioJob(job, abortController);
  return job;
}

async function cancelStudioJob() {
  const job = await getStudioJob();
  if (!job || job.status !== "running") return job;
  if (activeStudioJobId === job.id) {
    activeStudioAbortController?.abort();
  }
  const updated = {
    ...appendStudioEvent(job, { type: "error", message: "Cancelled by user", stage: "cancelled" }),
    status: "cancelled" as const,
    error: "Cancelled by user",
    updatedAt: new Date().toISOString(),
  };
  await setStudioJob(updated);
  return updated;
}

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    if ((message as { type?: string }).type === OFFSCREEN_COPY_MESSAGE) return false;
    if ((message as { type?: string }).type === OFFSCREEN_RUN_SCRIPT_MESSAGE) return false;

    void (async () => {
      try {
        if (message.type === "GET_ACTIVE_TAB") {
          sendResponse({ ok: true, tab: await getActiveTab() });
          return;
        }

        if (message.type === "CREATE_SNAPSHOT") {
          sendResponse({ ok: true, ...(await createSnapshotOnActiveTab()) });
          return;
        }

        if (message.type === "LIST_PROFILES_FOR_SITE") {
          const profiles = (await getProfiles()).filter((profile) => matchesUrlPattern(profile.urlPattern, message.url));
          sendResponse({ ok: true, profiles });
          return;
        }

        if (message.type === "LIST_ALL_PROFILES") {
          sendResponse({ ok: true, profiles: await getProfiles() });
          return;
        }

        if (message.type === "SAVE_PROFILE") {
          sendResponse({ ok: true, profile: await saveProfile(message.profile) });
          return;
        }

        if (message.type === "UPDATE_PROFILE") {
          sendResponse({ ok: true, profile: await updateProfile(message.profileId, message.updates) });
          return;
        }

        if (message.type === "DELETE_PROFILE") {
          await deleteProfile(message.profileId);
          sendResponse({ ok: true, profiles: await getProfiles() });
          return;
        }

        if (message.type === "RUN_PROFILE") {
          sendResponse({ ok: true, run: await runProfile(message.profileId, message.actionPresetOverride) });
          return;
        }

        if (message.type === "RUN_PROFILE_PREVIEW") {
          const preview = await runProfilePreview(message.profile);
          sendResponse({ ok: true, ...preview });
          return;
        }

        if (message.type === "RUN_SCRIPT_PREVIEW") {
          const output = await runScript(message.script.code, message.input);
          sendResponse({ ok: true, output });
          return;
        }

        if (message.type === "START_STUDIO_GENERATE") {
          sendResponse({ ok: true, job: await startStudioGenerate(message) });
          return;
        }

        if (message.type === "GET_STUDIO_JOB") {
          sendResponse({ ok: true, job: await getStudioJob() });
          return;
        }

        if (message.type === "CANCEL_STUDIO_JOB") {
          sendResponse({ ok: true, job: await cancelStudioJob() });
          return;
        }

        if (message.type === "CLEAR_STUDIO_JOB") {
          const job = await getStudioJob();
          if (job?.status === "running") {
            await cancelStudioJob();
          }
          await setStudioJob(null);
          sendResponse({ ok: true, job: null });
          return;
        }

        sendResponse({ ok: false, error: "Unknown background message." });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "run-last-profile") return;

  void (async () => {
    const tab = await getActiveTab().catch(() => null);
    if (!tab) return;

    try {
      ensureInjectableTab(tab.url);
    } catch {
      return;
    }

    const profile = await getLastUsedProfileForSite(tab.url);
    if (!profile) {
      await showToast(tab.id, tab.url, "No saved WebRelay profile for this site.", "info");
      return;
    }

    try {
      const { actionResult } = await runProfile(profile.id);
      if (actionResult.errors.length > 0) {
        await showToast(tab.id, tab.url, `Run failed: ${actionResult.errors[0]}`, "error");
        return;
      }
      const parts = ([actionResult.copied && "Copied", actionResult.downloaded && "Downloaded"] as (string | false)[])
        .filter(Boolean)
        .join(" / ");
      await showToast(tab.id, tab.url, parts || "Done", "success");
    } catch (error) {
      await showToast(tab.id, tab.url, `Run failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  })();
});
