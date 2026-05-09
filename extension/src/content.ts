import { createDomSnapshot, executeRecipe, extractionRecipeSchema } from "@extractor/shared";
import type { ContentRequest, ContentResponse, ToastVariant } from "./messages.js";

function showToast(message: string, variant: ToastVariant) {
  const existing = document.getElementById("webrelay-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "webrelay-toast";
  const bg: Record<ToastVariant, string> = {
    success: "#227d4d",
    error: "#c7353a",
    info: "#2463c7",
  };

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    maxWidth: "360px",
    padding: "10px 14px",
    borderRadius: "6px",
    background: bg[variant],
    color: "#fff",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    lineHeight: "1.4",
    boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
    opacity: "1",
    pointerEvents: "none",
    transition: "opacity 0.2s ease",
  });
  toast.textContent = message;
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    window.setTimeout(() => toast.remove(), 250);
  }, 3000);
}

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

      if (message.type === "SHOW_TOAST") {
        showToast(message.message, message.variant);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown content message." });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);
