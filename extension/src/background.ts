import {
  extractionProfileSchema,
  extractionRecipeSchema,
  matchesUrlPattern,
  type ExtractionProfile,
} from "@extractor/shared";
import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentResponse,
} from "./messages.js";

const BACKEND_URL = "http://localhost:8787";
const PROFILES_KEY = "profiles";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page tab found.");
  return { id: tab.id, url: tab.url, title: tab.title || tab.url };
}

async function sendToContent(
  message: Extract<BackgroundRequest, { type: "CREATE_SNAPSHOT" | "RUN_RECIPE" }>,
): Promise<ContentResponse> {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function getProfiles(): Promise<ExtractionProfile[]> {
  const data = await chrome.storage.local.get(PROFILES_KEY);
  const profiles = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  return profiles
    .map((profile) => extractionProfileSchema.safeParse(profile))
    .filter((result) => result.success)
    .map((result) => result.data);
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

        if (message.type === "GENERATE_RECIPE") {
          const payload = await postBackend("/generate-recipe", {
            url: message.url,
            intent: message.intent,
            domSnapshot: message.domSnapshot,
          });
          sendResponse({ ok: true, recipe: extractionRecipeSchema.parse(payload.recipe) });
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
