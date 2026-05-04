import { createDomSnapshot, executeRecipe, extractionRecipeSchema } from "@extractor/shared";
import type { ContentRequest, ContentResponse } from "./messages.js";

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
    try {
      if (message.type === "CREATE_SNAPSHOT") {
        sendResponse({ ok: true, snapshot: createDomSnapshot(), url: location.href });
        return;
      }

      if (message.type === "RUN_RECIPE") {
        const recipe = extractionRecipeSchema.parse(message.recipe);
        sendResponse({ ok: true, result: executeRecipe(recipe) });
        return;
      }

      sendResponse({ ok: false, error: "Unknown content message." });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);
