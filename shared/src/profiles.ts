export function createUrlPattern(urlValue: string) {
  const url = new URL(urlValue);
  const parts = url.pathname
    .split("/")
    .map((part) => {
      if (/^\d+$/.test(part)) return "*";
      if (/^[0-9a-f]{8,}$/i.test(part)) return "*";
      return part;
    })
    .join("/");
  return `${url.origin}${parts || "/"}`;
}

export function matchesUrlPattern(pattern: string, urlValue: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(urlValue);
}
