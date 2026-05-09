export function createUrlPattern(urlValue: string) {
  const url = new URL(urlValue);
  return `*://${url.hostname}/*`;
}

export function matchesUrlPattern(pattern: string, urlValue: string) {
  const url = new URL(urlValue);
  const hostnamePattern = pattern.match(/^\*:\/\/([^/]+)\/\*$/);
  if (hostnamePattern) {
    return hostnamePattern[1] === url.hostname;
  }

  const legacyUrl = parseLegacyPatternUrl(pattern);
  if (legacyUrl) {
    return legacyUrl.hostname === url.hostname;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(urlValue);
}

function parseLegacyPatternUrl(pattern: string) {
  try {
    return new URL(pattern.replace(/\*/g, "x"));
  } catch {
    return null;
  }
}
