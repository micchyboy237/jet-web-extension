// background.js (Manifest V3)
// Behavior:
// - Keep the NEW tab
// - Close EXISTING duplicate tabs
// - Trigger only when URL is fully resolved

/**
 * Normalize URLs so duplicates are detected consistently.
 * You can customize this depending on how strict you want it.
 */
function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    // Remove hash (#section)
    url.hash = "";

    // OPTIONAL: remove query params
    // url.search = "";

    // Normalize trailing slash
    url.pathname = url.pathname.replace(/\/$/, "");

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Returns true if this URL should be ignored.
 */
function shouldIgnoreUrl(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:")
  );
}

/**
 * Main duplicate detection logic
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act once the tab is fully loaded
  if (changeInfo.status !== "complete") return;
  if (!tab.url || shouldIgnoreUrl(tab.url)) return;

  const normalizedNewUrl = normalizeUrl(tab.url);
  if (!normalizedNewUrl) return;

  const allTabs = await chrome.tabs.query({});

  for (const existingTab of allTabs) {
    if (
      existingTab.id === tab.id || // never touch the new tab
      !existingTab.url ||
      shouldIgnoreUrl(existingTab.url)
    ) {
      continue;
    }

    const normalizedExistingUrl = normalizeUrl(existingTab.url);
    if (!normalizedExistingUrl) continue;

    if (normalizedExistingUrl === normalizedNewUrl) {
      // Close the OLD tab
      chrome.tabs.remove(existingTab.id);
    }
  }
});
