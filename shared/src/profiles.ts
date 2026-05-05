export function createUrlPattern(urlValue: string) {
  const url = new URL(urlValue);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return `${url.origin}/`;

  const normalizedParts = parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    if (/^\d+$/.test(part)) return "*";
    if (/^[0-9a-f]{8,}$/i.test(part)) return "*";
    if (isLast && looksLikeContentSlug(part)) return "*";
    return part;
  });
  return `${url.origin}/${normalizedParts.join("/")}`;
}

export function matchesUrlPattern(pattern: string, urlValue: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(urlValue);
}

function looksLikeContentSlug(part: string) {
  if (/\.[A-Za-z0-9]{1,5}$/.test(part)) return false;
  return part.includes("-") || part.includes("_") || part.length >= 16;
}
