let requestHistory = [];

const MAX_HISTORY = 1500;

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const entry = {
      id: details.requestId,
      time: new Date().toISOString(),
      method: details.method || "GET",
      url: details.url,
      type: details.type || "other",
      tabId: details.tabId,
      initiator: details.initiator || details.originUrl || null,
      status: null, // will be filled later
    };

    requestHistory.push(entry);

    // Keep size under control (oldest first)
    if (requestHistory.length > MAX_HISTORY) {
      requestHistory.shift();
    }
  },
  { urls: ["<all_urls>"] },
  ["extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const entry = requestHistory.find((r) => r.id === details.requestId);
    if (entry) {
      entry.status = details.statusCode;
      entry.timeCompleted = new Date().toISOString();
    }
  },
  { urls: ["<all_urls>"] },
  ["extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const entry = requestHistory.find((r) => r.id === details.requestId);
    if (entry) {
      entry.status = "ERROR";
      entry.error = details.error;
      entry.timeCompleted = new Date().toISOString();
    }
  },
  { urls: ["<all_urls>"] }
);

// Communication with popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getNetworkHistory") {
    sendResponse({ history: [...requestHistory].reverse() }); // newest first
  } else if (message.action === "clearNetworkHistory") {
    requestHistory = [];
    sendResponse({ success: true });
  }
  return true; // keep channel open for async response
});
