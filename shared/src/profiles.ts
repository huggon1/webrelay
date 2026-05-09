export function createUrlPattern(urlValue: string) {
  const url = new URL(urlValue);
  if (url.protocol === "file:") return "file:///*";
  return `*://${url.hostname}/*`;
}

export function matchesUrlPattern(pattern: string, urlValue: string) {
  const url = new URL(urlValue);
  if (pattern === "file:///*") return url.protocol === "file:";
  const hostnamePattern = pattern.match(/^\*:\/\/([^/]+)\/\*$/);
  if (hostnamePattern) {
    return hostnamePattern[1] === url.hostname;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(urlValue);
}
