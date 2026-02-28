document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const zoomRadios = document.querySelectorAll('input[name="zoom-level"]');
  const resetZoomBtn = document.getElementById("btn-reset-zoom");

  // ADDITIONS FOR DEDUP TOGGLE AND MANUAL BUTTON
  const toggle = document.getElementById("toggle-dedup");
  const dedupBtn = document.getElementById("btn-dedup-now");

  // ── Zoom control ────────────────────────────────────────────────
  async function updateZoomUI() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;

      const currentZoom = await chrome.tabs.getZoom(tab.id);

      let bestMatch = "0.8";
      let minDiff = Infinity;

      zoomRadios.forEach((radio) => {
        const val = parseFloat(radio.value);
        const diff = Math.abs(val - currentZoom);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = radio.value;
        }
      });

      document.querySelector(
        `input[name="zoom-level"][value="${bestMatch}"]`,
      ).checked = true;
    } catch (err) {
      console.warn("Could not read current zoom:", err);
      document.querySelector('input[name="zoom-level"][value="0.8"]').checked =
        true;
    }
  }

  async function applyZoom(zoomFactor) {
    try {
      const zoom = parseFloat(zoomFactor);
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) throw new Error("No active tab");

      await chrome.tabs.setZoom(tab.id, zoom);

      // After reset we show the 80% radio (user's default)
      if (zoomFactor === "0") {
        document.querySelector(
          'input[name="zoom-level"][value="0.8"]',
        ).checked = true;
      }

      const displayText =
        zoomFactor === "0" ? "default (80%)" : (zoom * 100).toFixed(0) + "%";
      status.textContent = `Zoom set to ${displayText} ✓`;
      status.style.color = "green";
    } catch (err) {
      console.error("Zoom change failed:", err);
      status.textContent = "Could not change zoom (internal page?)";
      status.style.color = "red";
    }
  }

  // Zoom listeners & init
  if (zoomRadios.length > 0) {
    updateZoomUI();

    zoomRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        if (e.target.checked) {
          applyZoom(e.target.value);
        }
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.metaKey) {
        let zoomValue = null;

        switch (e.code) {
          case "Digit1":
            zoomValue = "0.8"; // ⌘+1 → 80%
            break;
          case "Digit2":
            zoomValue = "1"; // ⌘+2 → 100%
            break;
          case "Digit3":
            zoomValue = "1.5"; // ⌘+3 → 150%
            break;
          case "Digit4":
            zoomValue = "2"; // ⌘+4 → 200%
            break;
        }

        if (zoomValue) {
          const radio = document.querySelector(
            `input[name="zoom-level"][value="${zoomValue}"]`,
          );
          if (radio) {
            // Optional: small debug confirmation
            // console.log(`Keyboard zoom activated: ${zoomValue} via ${e.code}`);
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            e.preventDefault();
          }
        }
      }
    });

    // Force popup to receive keyboard focus immediately (keep this)
    window.focus();
    document.body.focus();
  }

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

  // Button 5: Summarize Page (opens detached window)
  const summarizeBtn = document.getElementById("btn-summarize");

  if (summarizeBtn) {
    summarizeBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) return;

      chrome.windows.create({
        url: chrome.runtime.getURL(`summarization.html?tabId=${tab.id}`),
        type: "popup",
        width: 500,
        height: 400,
        left: 150,
        top: 100,
      });
    };
  }
});
