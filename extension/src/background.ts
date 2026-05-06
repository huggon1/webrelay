import {
  actionPresetSchema,
  createUrlPattern,
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
  ContentRequest,
  ContentResponse,
  IntentAnalysis,
  ToastVariant,
} from "./messages.js";

const BACKEND_URL = "http://localhost:8787";
const PROFILES_KEY = "profiles";
const LAST_USED_BY_SITE_KEY = "lastUsedBySite";
const OFFSCREEN_COPY_MESSAGE = "OFFSCREEN_COPY";

// ── Tab utilities ──────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page tab found.");
  return { id: tab.id, url: tab.url, title: tab.title || tab.url };
}

function ensureInjectableTab(urlValue: string) {
  const url = new URL(urlValue);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WebRelay can only inspect regular http and https pages.");
  }
  if (url.hostname === "chromewebstore.google.com") {
    throw new Error("Chrome does not allow extensions to inspect the Chrome Web Store.");
  }
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

async function sendToContentByActiveTab(
  message: Extract<ContentRequest, { type: "CREATE_SNAPSHOT" | "RUN_RECIPE" }>,
): Promise<ContentResponse> {
  const tab = await getActiveTab();
  ensureInjectableTab(tab.url);
  return sendToContent(tab.id, message);
}

// ── Toast ──────────────────────────────────────────────────────────────────

async function showToast(tabId: number, tabUrl: string, message: string, variant: ToastVariant) {
  try {
    ensureInjectableTab(tabUrl);
    await sendToContent(tabId, { type: "SHOW_TOAST", message, variant });
  } catch {
    // Toast is best-effort; ignore errors
  }
}

// ── Storage helpers ────────────────────────────────────────────────────────

async function getProfiles(): Promise<ExtractionProfile[]> {
  const data = await chrome.storage.local.get(PROFILES_KEY);
  const raw = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  const profiles = raw
    .map((p) => extractionProfileSchema.safeParse(p))
    .filter((r) => r.success)
    .map((r) => r.data);
  if (JSON.stringify(profiles) !== JSON.stringify(raw)) {
    await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }
  return profiles;
}

async function saveProfile(profile: ExtractionProfile) {
  const parsed = extractionProfileSchema.parse(profile);
  const existing = await getProfiles();
  await chrome.storage.local.set({
    [PROFILES_KEY]: [parsed, ...existing.filter((p) => p.id !== parsed.id)],
  });
  return parsed;
}

async function updateProfile(profileId: string, updates: Partial<ExtractionProfile>) {
  const profiles = await getProfiles();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) throw new Error("Profile not found.");
  const merged = extractionProfileSchema.parse({ ...profiles[idx], ...updates, id: profileId });
  profiles[idx] = merged;
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  return merged;
}

async function deleteProfile(profileId: string) {
  const profiles = await getProfiles();
  await chrome.storage.local.set({
    [PROFILES_KEY]: profiles.filter((p) => p.id !== profileId),
  });
}

async function updateLastUsed(profile: ExtractionProfile, actionPreset: ActionPreset, urlValue: string) {
  const url = new URL(urlValue);
  const data = await chrome.storage.local.get(LAST_USED_BY_SITE_KEY);
  const existing =
    data[LAST_USED_BY_SITE_KEY] && typeof data[LAST_USED_BY_SITE_KEY] === "object" && !Array.isArray(data[LAST_USED_BY_SITE_KEY])
      ? data[LAST_USED_BY_SITE_KEY]
      : {};
  const state = lastUsedStateSchema.parse({
    siteId: url.hostname,
    configurationId: profile.id,
    urlPattern: createUrlPattern(urlValue),
    lastRunAt: new Date().toISOString(),
    lastActionPreset: actionPreset,
  });
  await chrome.storage.local.set({
    [LAST_USED_BY_SITE_KEY]: { ...existing, [state.siteId]: state },
  });
}

async function getLastUsedProfileForSite(urlValue: string): Promise<ExtractionProfile | null> {
  const url = new URL(urlValue);
  const data = await chrome.storage.local.get(LAST_USED_BY_SITE_KEY);
  const map = data[LAST_USED_BY_SITE_KEY] ?? {};
  const state = map[url.hostname] ?? map[url.origin];
  if (!state?.configurationId) return null;
  const profiles = await getProfiles();
  return profiles.find((p) => p.id === state.configurationId && matchesUrlPattern(p.urlPattern, urlValue)) ?? null;
}

// ── Transform execution (runs in page context to allow new Function) ───────

async function runTransformInPage(tabId: number, transform: import("@extractor/shared").TransformSpec, data: unknown): Promise<ExportResult> {
  try {
    const [{ result: output }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [transform.code, data],
      func: (code: string, input: unknown): string => {
        // eslint-disable-next-line no-new-func
        const fn = new Function("input", code) as (input: unknown) => string;
        return fn(input);
      },
    });
    if (typeof output !== "string") throw new Error("Transform did not return a string.");
    return { formatLabel: transform.formatLabel, content: output, warnings: [] };
  } catch (error) {
    const raw = fallbackExportResult(data);
    raw.warnings.push(`Transform failed: ${error instanceof Error ? error.message : String(error)}`);
    return raw;
  }
}

// ── Action execution ───────────────────────────────────────────────────────

function fallbackExportResult(data: unknown): ExportResult {
  return { formatLabel: "JSON", content: JSON.stringify(data, null, 2), warnings: [] };
}

function extensionForFormat(formatLabel: string) {
  const lc = formatLabel.toLowerCase();
  if (lc.includes("markdown")) return "md";
  if (lc.includes("csv")) return "csv";
  if (lc.includes("json")) return "json";
  return "txt";
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim();
}

function createDownloadFilename(profile: ExtractionProfile | undefined, exportResult: ExportResult) {
  const baseName = sanitizeFilenamePart(profile?.name ?? "webrelay-export") || "webrelay-export";
  const date = new Date().toISOString().slice(0, 10);
  return `${baseName}-${date}.${extensionForFormat(exportResult.formatLabel)}`;
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
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: "Write WebRelay extraction results to the clipboard.",
  });
}

async function copyExportContent(content: string) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: OFFSCREEN_COPY_MESSAGE,
    content,
  }) as { ok: true } | { ok: false; error: string } | undefined;
  if (!response?.ok) {
    throw new Error(response?.error || "Clipboard write failed.");
  }
}

async function downloadExportContent(exportResult: ExportResult, profile?: ExtractionProfile) {
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(exportResult.content)}`;
  await chrome.downloads.download({
    url,
    filename: createDownloadFilename(profile, exportResult),
    saveAs: false,
  });
}

async function applyAction(exportResult: ExportResult, actionPreset: ActionPreset, profile?: ExtractionProfile): Promise<ActionRunResult> {
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

// ── Profile runner ─────────────────────────────────────────────────────────

async function runProfile(profileId: string, actionPresetOverride?: ActionPreset) {
  const tab = await getActiveTab();
  const profile = (await getProfiles()).find(
    (p) => p.id === profileId && matchesUrlPattern(p.urlPattern, tab.url),
  );
  if (!profile) throw new Error("No matching saved configuration was found.");

  const contentResponse = await sendToContentByActiveTab({ type: "RUN_RECIPE", recipe: profile.recipe });
  if (!contentResponse.ok) throw new Error(contentResponse.error);
  if (!("result" in contentResponse)) throw new Error("Profile run response was incomplete.");

  const result = contentResponse.result;
  const exportResult: ExportResult = profile.transform
    ? await runTransformInPage(tab.id, profile.transform, result.data)
    : fallbackExportResult(result.data);

  const actionPreset = actionPresetOverride ? actionPresetSchema.parse(actionPresetOverride) : profile.actionPreset;
  const actionResult = await applyAction(exportResult, actionPreset, profile);

  const now = new Date().toISOString();
  const hostnameUrlPattern = createUrlPattern(tab.url);
  if (!result.ok || (result.ok && result.debug.rootMatchCount === 0 && result.debug.mode === "list")) {
    // Auto-mark as possibly failed
    await updateProfile(profileId, { status: "possibly_failed", urlPattern: hostnameUrlPattern, lastRunAt: now, updatedAt: now });
  } else {
    await updateProfile(profileId, { status: "ok", urlPattern: hostnameUrlPattern, actionPreset, lastRunAt: now, updatedAt: now });
    await updateLastUsed(profile, actionPreset, tab.url);
  }

  return { result, exportResult, actionResult };
}

// ── Backend proxy ──────────────────────────────────────────────────────────

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

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    if ((message as { type?: string }).type === OFFSCREEN_COPY_MESSAGE) return false;

    void (async () => {
      try {
        if (message.type === "GET_ACTIVE_TAB") {
          sendResponse({ ok: true, tab: await getActiveTab() });
          return;
        }

        if (message.type === "CREATE_SNAPSHOT") {
          const response = await sendToContentByActiveTab({ type: "CREATE_SNAPSHOT" });
          if (!response.ok) throw new Error(response.error);
          if (!("snapshot" in response)) throw new Error("Snapshot response incomplete.");
          sendResponse({ ok: true, snapshot: response.snapshot, url: response.url });
          return;
        }

        if (message.type === "LIST_PROFILES_FOR_SITE") {
          const profiles = (await getProfiles()).filter((p) => matchesUrlPattern(p.urlPattern, message.url));
          sendResponse({ ok: true, profiles });
          return;
        }

        if (message.type === "LIST_ALL_PROFILES") {
          sendResponse({ ok: true, profiles: await getProfiles() });
          return;
        }

        if (message.type === "RUN_PROFILE") {
          const response = await runProfile(message.profileId, message.actionPresetOverride);
          sendResponse({ ok: true, ...response });
          return;
        }

        if (message.type === "ANALYZE_INTENT") {
          const payload = await postBackend("/analyze-intent", {
            domSnapshot: message.domSnapshot,
            url: message.url,
          });
          sendResponse({ ok: true, analysis: payload.analysis as IntentAnalysis });
          return;
        }

        if (message.type === "GENERATE_RECIPE") {
          const payload = await postBackend("/generate-recipe", {
            url: message.url,
            intent: message.intent,
            domSnapshot: message.domSnapshot,
            confirmedFields: message.confirmedFields,
          });
          const recipe = extractionRecipeSchema.parse(payload.recipe);
          // Run the recipe immediately for preview
          const contentResponse = await sendToContentByActiveTab({ type: "RUN_RECIPE", recipe });
          if (!contentResponse.ok) throw new Error(contentResponse.error);
          if (!("result" in contentResponse)) throw new Error("Recipe run response incomplete.");
          sendResponse({ ok: true, recipe, result: contentResponse.result });
          return;
        }

        if (message.type === "REFINE_RECIPE") {
          const payload = await postBackend("/refine", {
            url: message.url,
            intent: message.intent,
            feedback: message.feedback,
            domSnapshot: message.domSnapshot,
            currentRecipe: message.currentRecipe,
            currentResult: message.currentResult,
          });
          const artifact = extractionArtifactSchema.parse(payload.artifact);
          const recipe = artifact.recipe;
          const transform = artifact.transform ?? null;
          const tab = await getActiveTab();
          const contentResponse = await sendToContent(tab.id, { type: "RUN_RECIPE", recipe });
          if (!contentResponse.ok) throw new Error(contentResponse.error);
          if (!("result" in contentResponse)) throw new Error("Recipe run response incomplete.");
          const result = contentResponse.result;
          const exportResult = transform
            ? await runTransformInPage(tab.id, transform, result.data)
            : fallbackExportResult(result.data);
          sendResponse({ ok: true, recipe, result, transform, exportResult });
          return;
        }

        if (message.type === "GENERATE_TRANSFORM") {
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

        if (message.type === "REPAIR_RECIPE") {
          const profiles = await getProfiles();
          const profile = profiles.find((p) => p.id === message.profileId);
          if (!profile) throw new Error("Profile not found.");
          const payload = await postBackend("/repair-recipe", {
            url: message.url,
            intent: profile.intent,
            domSnapshot: message.domSnapshot,
            oldRecipe: profile.recipe,
            userNote: message.userNote,
          });
          const recipe = extractionRecipeSchema.parse(payload.recipe);
          const contentResponse = await sendToContentByActiveTab({ type: "RUN_RECIPE", recipe });
          if (!contentResponse.ok) throw new Error(contentResponse.error);
          if (!("result" in contentResponse)) throw new Error("Recipe run response incomplete.");
          sendResponse({ ok: true, recipe, result: contentResponse.result });
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

        sendResponse({ ok: false, error: "Unknown background message." });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  },
);

// ── Keyboard shortcut handler ──────────────────────────────────────────────

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
      await showToast(tab.id, tab.url, "No saved configuration for this site. Open WebRelay to create one.", "info");
      return;
    }

    try {
      const { actionResult } = await runProfile(profile.id);
      const errors = actionResult.errors;
      if (errors.length > 0) {
        await showToast(tab.id, tab.url, `Run failed: ${errors[0]}`, "error");
      } else {
        const parts: string[] = [];
        if (actionResult.copied) parts.push("Copied to clipboard");
        if (actionResult.downloaded) parts.push("Downloaded");
        await showToast(tab.id, tab.url, parts.join(" / ") || "Done", "success");
      }
    } catch (error) {
      await showToast(tab.id, tab.url, `Run failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  })();
});
