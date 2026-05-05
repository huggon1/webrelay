import {
  actionPresetSchema,
  extractionArtifactSchema,
  extractionProfileSchema,
  extractionRecipeSchema,
  exportResultSchema,
  lastUsedStateSchema,
  matchesUrlPattern,
  transformSpecSchema,
  type ActionPreset,
  type ExportResult,
  type ExtractionProfile,
} from "@extractor/shared";
import type {
  ActionRunResult,
  BackgroundRequest,
  BackgroundResponse,
  ContentResponse,
} from "./messages.js";

const BACKEND_URL = "http://localhost:8787";
const PROFILES_KEY = "profiles";
const LAST_USED_BY_SITE_KEY = "lastUsedBySite";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page tab found.");
  return { id: tab.id, url: tab.url, title: tab.title || tab.url };
}

async function sendToContent(
  message: Extract<BackgroundRequest, { type: "CREATE_SNAPSHOT" | "RUN_RECIPE" }>,
): Promise<ContentResponse> {
  const tab = await getActiveTab();
  ensureInjectableTab(tab.url);
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function ensureInjectableTab(urlValue: string) {
  const url = new URL(urlValue);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WebRelay can only inspect regular http and https pages. Open a normal web page and try again.");
  }
  if (url.hostname === "chromewebstore.google.com") {
    throw new Error("Chrome does not allow extensions to inspect the Chrome Web Store.");
  }
}

function isMissingContentScriptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Could not establish connection") || message.includes("Receiving end does not exist");
}

async function getProfiles(): Promise<ExtractionProfile[]> {
  const data = await chrome.storage.local.get(PROFILES_KEY);
  const profiles = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  const parsedProfiles = profiles
    .map((profile) => extractionProfileSchema.safeParse(profile))
    .filter((result) => result.success)
    .map((result) => result.data);
  if (JSON.stringify(parsedProfiles) !== JSON.stringify(profiles)) {
    await chrome.storage.local.set({ [PROFILES_KEY]: parsedProfiles });
  }
  return parsedProfiles;
}

async function saveProfile(profile: ExtractionProfile) {
  const parsed = extractionProfileSchema.parse(profile);
  const existing = await getProfiles();
  const next = [parsed, ...existing.filter((item) => item.id !== parsed.id)];
  await chrome.storage.local.set({ [PROFILES_KEY]: next });
  return parsed;
}

async function postBackend(path: string, body: unknown) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Backend request failed: ${response.status}`);
  }
  return payload;
}

function siteIdFromUrl(urlValue: string) {
  return new URL(urlValue).origin;
}

function fallbackExportResult(data: unknown): ExportResult {
  return safePreviewExport(data);
}

function extensionForFormat(formatLabel: string) {
  const normalized = formatLabel.toLowerCase();
  if (normalized.includes("markdown")) return "md";
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("json")) return "json";
  return "txt";
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
}

function createDownloadFilename(profile: ExtractionProfile | undefined, exportResult: ExportResult) {
  const baseName = sanitizeFilenamePart(profile?.name || "webrelay-export") || "webrelay-export";
  const date = new Date().toISOString().slice(0, 10);
  return `${baseName}-${date}.${extensionForFormat(exportResult.formatLabel)}`;
}

async function copyExportContent(content: string) {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [content],
    func: async (value: string) => {
      await navigator.clipboard.writeText(value);
    },
  });
}

async function downloadExportContent(exportResult: ExportResult, profile?: ExtractionProfile) {
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(exportResult.content)}`;
  await chrome.downloads.download({
    url,
    filename: createDownloadFilename(profile, exportResult),
    saveAs: false,
  });
}

async function applyAction(
  exportResult: ExportResult,
  actionPreset: ActionPreset,
  profile?: ExtractionProfile,
): Promise<ActionRunResult> {
  const parsed = actionPresetSchema.parse(actionPreset);
  const result: ActionRunResult = { copied: false, downloaded: false, errors: [] };

  if (parsed.type === "copy" || parsed.type === "copy_download") {
    try {
      await copyExportContent(exportResult.content);
      result.copied = true;
    } catch (error) {
      result.errors.push(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (parsed.type === "download" || parsed.type === "copy_download") {
    try {
      await downloadExportContent(exportResult, profile);
      result.downloaded = true;
    } catch (error) {
      result.errors.push(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

async function updateLastUsed(profile: ExtractionProfile, actionPreset: ActionPreset, urlValue: string) {
  const data = await chrome.storage.local.get(LAST_USED_BY_SITE_KEY);
  const existing =
    data[LAST_USED_BY_SITE_KEY] &&
    typeof data[LAST_USED_BY_SITE_KEY] === "object" &&
    !Array.isArray(data[LAST_USED_BY_SITE_KEY])
      ? data[LAST_USED_BY_SITE_KEY]
      : {};
  const state = lastUsedStateSchema.parse({
    siteId: siteIdFromUrl(urlValue),
    configurationId: profile.id,
    urlPattern: profile.urlPattern,
    lastRunAt: new Date().toISOString(),
    lastActionPreset: actionPreset,
  });
  await chrome.storage.local.set({
    [LAST_USED_BY_SITE_KEY]: {
      ...existing,
      [state.siteId]: state,
    },
  });
}

async function runProfile(profileId: string, actionOverride?: ActionPreset, shouldApplyAction = true) {
  const tab = await getActiveTab();
  const profile = (await getProfiles()).find(
    (candidate) => candidate.id === profileId && matchesUrlPattern(candidate.urlPattern, tab.url),
  );
  if (!profile) throw new Error("No matching saved configuration was found.");

  const response = await sendToContent({ type: "RUN_RECIPE", recipe: profile.recipe });
  if (!response.ok) throw new Error(response.error);
  if (!("result" in response)) throw new Error("Profile run response was incomplete.");
  const result = response.result;
  let exportResult: ExportResult | undefined;
  if (profile.transform) {
    try {
      const payload = await postBackend("/run-transform", {
        transform: profile.transform,
        data: result.data,
      });
      exportResult = exportResultSchema.parse(payload.exportResult);
    } catch (error) {
      exportResult = {
        ...fallbackExportResult(result.data),
        warnings: [`Saved output transform failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  } else {
    exportResult = fallbackExportResult(result.data);
  }

  const actionPreset = actionOverride ? actionPresetSchema.parse(actionOverride) : profile.actionPreset;
  const actionResult = shouldApplyAction
    ? await applyAction(exportResult, actionPreset, profile)
    : { copied: false, downloaded: false, errors: [] };
  if (result.ok && (!shouldApplyAction || actionResult.errors.length === 0)) {
    await updateLastUsed(profile, actionPreset, tab.url);
  }
  return { result, exportResult, actionResult };
}

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    void (async () => {
      try {
        if (message.type === "GET_ACTIVE_TAB") {
          sendResponse({ ok: true, tab: await getActiveTab() });
          return;
        }

        if (message.type === "CREATE_SNAPSHOT" || message.type === "RUN_RECIPE") {
          const response = await sendToContent(message);
          if (!response.ok) throw new Error(response.error);
          sendResponse(response);
          return;
        }

        if (message.type === "RUN_PROFILE") {
          const response = await runProfile(message.profileId, message.actionPreset, message.applyAction);
          sendResponse({ ok: true, ...response });
          return;
        }

        if (message.type === "GENERATE_RECIPE") {
          const payload = await postBackend("/generate-recipe", {
            url: message.url,
            intent: message.intent,
            domSnapshot: message.domSnapshot,
          });
          sendResponse({ ok: true, recipe: extractionRecipeSchema.parse(payload.recipe) });
          return;
        }

        if (message.type === "TRANSFORM_RESULT") {
          const payload = await postBackend("/transform", {
            intent: message.intent,
            outputRequest: message.outputRequest,
            result: message.result,
          });
          sendResponse({
            ok: true,
            transform: payload.transform ? transformSpecSchema.parse(payload.transform) : null,
            exportResult: exportResultSchema.parse(payload.exportResult),
          });
          return;
        }

        if (message.type === "RUN_TRANSFORM") {
          const payload = await postBackend("/run-transform", {
            transform: message.transform,
            data: message.data,
          });
          sendResponse({ ok: true, exportResult: exportResultSchema.parse(payload.exportResult) });
          return;
        }

        if (message.type === "MARK_PROFILE_USED") {
          const tab = await getActiveTab();
          await updateLastUsed(message.profile, actionPresetSchema.parse(message.actionPreset), tab.url);
          sendResponse({ ok: true, actionResult: { copied: false, downloaded: false, errors: [] } });
          return;
        }

        if (message.type === "APPLY_ACTION") {
          const exportResult = exportResultSchema.parse(message.exportResult);
          const actionPreset = actionPresetSchema.parse(message.actionPreset);
          const actionResult = await applyAction(exportResult, actionPreset, message.profile);
          if (message.profile && actionResult.errors.length === 0) {
            const tab = await getActiveTab();
            await updateLastUsed(message.profile, actionPreset, tab.url);
          }
          sendResponse({ ok: true, actionResult });
          return;
        }

        if (message.type === "REFINE_ARTIFACT") {
          const payload = await postBackend("/refine", {
            url: message.url,
            intent: message.intent,
            feedback: message.feedback,
            domSnapshot: message.domSnapshot,
            currentRecipe: message.currentRecipe,
            currentResult: message.currentResult,
          });
          sendResponse({
            ok: true,
            artifact: extractionArtifactSchema.parse(payload.artifact),
            exportResult: payload.exportResult ? exportResultSchema.parse(payload.exportResult) : undefined,
          });
          return;
        }

        if (message.type === "REPAIR_RECIPE") {
          const payload = await postBackend("/repair-recipe", {
            url: message.url,
            intent: message.intent,
            domSnapshot: message.domSnapshot,
            oldRecipe: message.oldRecipe,
            debug: message.debug,
            failureReason: message.failureReason,
          });
          sendResponse({ ok: true, recipe: extractionRecipeSchema.parse(payload.recipe) });
          return;
        }

        if (message.type === "LIST_PROFILES") {
          const tab = await getActiveTab();
          const profiles = (await getProfiles()).filter((profile) =>
            matchesUrlPattern(profile.urlPattern, tab.url),
          );
          sendResponse({ ok: true, profiles });
          return;
        }

        if (message.type === "SAVE_PROFILE") {
          sendResponse({ ok: true, profile: await saveProfile(message.profile) });
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
