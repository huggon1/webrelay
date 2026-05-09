export type DomSnapshotOptions = {
  maxChars?: number;
  document?: Document;
};

const REMOVE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "canvas",
  "audio",
  "video",
  "template",
];

const KEEP_ATTRIBUTES = new Set([
  "id",
  "class",
  "href",
  "src",
  "alt",
  "title",
  "aria-label",
]);

function isVisible(element: Element) {
  const htmlElement = element as HTMLElement;
  if (htmlElement.hidden) return false;
  const style = htmlElement.ownerDocument.defaultView?.getComputedStyle(htmlElement);
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function cleanElement(element: Element) {
  for (const child of Array.from(element.querySelectorAll(REMOVE_SELECTORS.join(",")))) {
    child.remove();
  }

  for (const child of Array.from(element.querySelectorAll("*"))) {
    if (!isVisible(child)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      if (!KEEP_ATTRIBUTES.has(attr.name) && !attr.name.startsWith("data-")) {
        child.removeAttribute(attr.name);
      }
    }
  }
}

function compactWhitespace(html: string) {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export function createDomSnapshot(options: DomSnapshotOptions = {}) {
  const maxChars = options.maxChars ?? 80_000;
  const doc = options.document ?? document;
  const clone = doc.body.cloneNode(true) as HTMLElement;
  cleanElement(clone);
  const title = doc.title ? `<title>${doc.title}</title>` : "";
  const snapshot = compactWhitespace(`${title}${clone.innerHTML}`);
  return snapshot.length > maxChars ? snapshot.slice(0, maxChars) : snapshot;
}
