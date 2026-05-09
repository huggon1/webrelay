import { createDomSnapshot, executeRecipe, extractionRecipeSchema } from "@extractor/shared";
import type { ContentRequest, ContentResponse, ToastVariant } from "./messages.js";

// ── Toast ──────────────────────────────────────────────────────────────────

function showToast(message: string, variant: ToastVariant) {
  const existing = document.getElementById("webrelay-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "webrelay-toast";

  const bg: Record<ToastVariant, string> = {
    success: "#2ea44f",
    error: "#cf222e",
    info: "#1f6feb",
  };

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    maxWidth: "340px",
    padding: "10px 14px",
    borderRadius: "8px",
    background: bg[variant],
    color: "#fff",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    lineHeight: "1.4",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    transition: "opacity 0.3s ease",
    opacity: "1",
    pointerEvents: "none",
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  const hide = () => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 350);
  };
  setTimeout(hide, 3000);
}

// ── Message handler ────────────────────────────────────────────────────────

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
