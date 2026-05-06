type OffscreenCopyRequest = {
  type: "OFFSCREEN_COPY";
  content: string;
};

function copyWithHiddenTextarea(content: string) {
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("document.execCommand('copy') returned false.");
}

chrome.runtime.onMessage.addListener((message: OffscreenCopyRequest, _sender, sendResponse) => {
  if (message.type !== "OFFSCREEN_COPY") return false;

  try {
    copyWithHiddenTextarea(message.content);
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  return false;
});
