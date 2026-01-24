// utils/urlUtils.js

export function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function isHttpUrl(url) {
  return url?.startsWith("http://") || url?.startsWith("https://");
}

export function shouldIgnoreUrl(url) {
  return !isHttpUrl(url);
}
