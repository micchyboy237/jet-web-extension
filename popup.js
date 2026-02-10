document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const zoomSelect = document.getElementById("zoom-select");
  const resetZoomBtn = document.getElementById("btn-reset-zoom");

  // ADDITIONS FOR DEDUP TOGGLE AND MANUAL BUTTON
  const toggle = document.getElementById("toggle-dedup");
  const dedupBtn = document.getElementById("btn-dedup-now");

  // ── Zoom control ────────────────────────────────────────────────
  async function updateZoomSelect() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;

      const currentZoom = await chrome.tabs.getZoom(tab.id);
      const value = currentZoom === 0 ? "0" : currentZoom.toString();

      // Try exact match, fallback to first option if no match
      zoomSelect.value = Array.from(zoomSelect.options).some(
        (opt) => opt.value === value,
      )
        ? value
        : "1"; // fallback to 100%
    } catch (err) {
      console.warn("Could not read current zoom", err);
      zoomSelect.value = "1";
    }
  }

  async function applyZoom(value) {
    try {
      const zoom = parseFloat(value);
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) throw new Error("No active tab");

      await chrome.tabs.setZoom(tab.id, zoom);

      // Special handling for reset: force select to show "Reset to default"
      if (value === "0" && zoomSelect) {
        zoomSelect.value = "0";
      }

      status.textContent = `Zoom set to ${value === "0" ? "default" : zoom * 100 + "%"} ✓`;
      status.style.color = "green";
    } catch (err) {
      console.error("Zoom change failed:", err);
      status.textContent = "Could not change zoom (internal page?)";
      status.style.color = "red";
    }
  }

  // Zoom listeners & init
  if (zoomSelect) {
    updateZoomSelect();

    zoomSelect.addEventListener("change", (e) => {
      applyZoom(e.target.value);
    });
  }

  // Reset zoom button
  if (resetZoomBtn) {
    resetZoomBtn.onclick = () => {
      applyZoom("0");
    };
  }

  // Load saved toggle state
  chrome.storage.local.get("urlDedupEnabled", (res) => {
    toggle.checked = res.urlDedupEnabled !== false; // default ON
  });

  // Toggle auto dedup
  toggle.addEventListener("change", () => {
    chrome.runtime.sendMessage({
      type: "SET_DEDUP_ENABLED",
      enabled: toggle.checked,
    });
  });

  // Manual dedup button
  dedupBtn.onclick = async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    chrome.runtime.sendMessage(
      {
        type: "MANUAL_DEDUP",
        activeTabId: activeTab?.id ?? null,
      },
      () => {
        status.textContent = "Duplicate tabs cleaned ✓";
        status.style.color = "green";
      },
    );
  };

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

  // Button 3: Network History
  document.getElementById("btn-network").onclick = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("network.html"),
      type: "popup",
      width: 900,
      height: 720,
      left: 120,
      top: 60,
    });
  };

  // Button 4: View History (compact)
  document.getElementById("btn-history").onclick = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("history.html"),
      type: "popup",
      width: 780,
      height: 600,
      left: 200,
      top: 120,
    });
  };
});
