// background.js (Manifest V3)

import { normalizeUrl, shouldIgnoreUrl } from "./utils/urlUtils.js";

const SETTINGS_KEY = "urlDedupEnabled";

/**
 * Check if deduplication is enabled
 */
async function isDedupEnabled() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] !== false; // default ON
}

/**
 * Core deduplication logic
 * @param {number|null} preferredTabId - tab to KEEP if duplicate exists
 */
async function deduplicateTabs(preferredTabId = null) {
  const tabs = await chrome.tabs.query({});
  const seen = new Map(); // normalizedUrl -> tabId to keep

  for (const tab of tabs) {
    if (!tab.url || shouldIgnoreUrl(tab.url)) continue;

    const normalized = normalizeUrl(tab.url);
    if (!normalized) continue;

    if (!seen.has(normalized)) {
      seen.set(normalized, tab.id);
      continue;
    }

    const existingTabId = seen.get(normalized);

    // If preferred tab exists, always keep it
    if (preferredTabId && tab.id === preferredTabId) {
      chrome.tabs.remove(existingTabId);
      seen.set(normalized, tab.id);
    } else if (preferredTabId && existingTabId === preferredTabId) {
      chrome.tabs.remove(tab.id);
    } else {
      // Default: keep the newer tab
      chrome.tabs.remove(existingTabId);
      seen.set(normalized, tab.id);
    }
  }
}

/**
 * Auto-dedup on tab update
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || shouldIgnoreUrl(tab.url)) return;
  if (!(await isDedupEnabled())) return;

  await deduplicateTabs(tab.id);
});

/**
 * Popup → background messaging
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MANUAL_DEDUP") {
    deduplicateTabs(message.activeTabId).then(() => {
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (message.type === "SET_DEDUP_ENABLED") {
    chrome.storage.local.set({ [SETTINGS_KEY]: message.enabled });
  }
});
