document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");

  // Button 1: Open tabs list
  document.getElementById("btn-tabs").onclick = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("tabs.html"),
      type: "popup",
      width: 620,
      height: 680,
      left: 180,
      top: 80,
    });
  };

  // Button 2: Copy current tab HTML
  document.getElementById("btn-copy-html").onclick = async () => {
    const status = document.getElementById("status");
    try {
      status.textContent = "Getting HTML...";
      status.style.color = "";

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) throw new Error("No active tab found");

      // Handle protected/internal browser pages gracefully
      if (
        tab.url?.startsWith("chrome://") ||
        tab.url?.startsWith("edge://") ||
        tab.url?.startsWith("opera://") ||
        tab.url?.startsWith("brave://")
      ) {
        status.textContent =
          "Cannot copy HTML from browser internal pages (chrome://, opera://, edge://, etc.). " +
          "Please try on a regular website (https://).";
        status.style.color = "#d97706"; // warning/amber
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });

      const html = results[0]?.result;
      if (typeof html !== "string" || html.length === 0) {
        throw new Error("Could not retrieve page HTML");
      }

      await navigator.clipboard.writeText(html);

      status.textContent = "HTML copied to clipboard! ✓";
      status.style.color = "#16a34a";
    } catch (err) {
      console.error("Copy HTML failed:", err);
      status.textContent = "Failed: " + (err.message || "Unknown error");
      status.style.color = "#dc2626";
    }
  };
});
