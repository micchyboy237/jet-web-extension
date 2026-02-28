// summarization.js
// Handles detached window + streaming call to backend

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function getTabIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("tabId");
  return id ? parseInt(id, 10) : null;
}

function getCurrentTabHTML(tabId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error("Missing tabId"));
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (
        !tab ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("opera://") ||
        tab.url.startsWith("brave://")
      ) {
        reject(
          new Error(
            "Cannot summarize internal browser pages (chrome://, edge://, etc.)",
          ),
        );
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(results?.[0]?.result || "");
          }
        },
      );
    });
  });
}

function streamSummary(html, statusEl, summaryEl, copyBtn) {
  statusEl.textContent = "Sending HTML to local LLM...";
  summaryEl.textContent = "";
  copyBtn.style.display = "none";

  let chunkIndex = 0;
  let totalChars = 0;

  fetch("http://localhost:8000/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("HTTP error! status: " + response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      statusEl.textContent = "Streaming summary...";

      function pump() {
        return reader.read().then(({ done, value }) => {
          if (done) {
            console.log(
              `%c[STREAM COMPLETE]`,
              "color: green; font-weight: bold;",
            );
            console.log(
              `Total chunks: ${chunkIndex}, Total chars: ${totalChars}`,
            );

            statusEl.textContent = "✅ Summary complete";
            copyBtn.style.display = "inline-block";
            return;
          }

          const chunkText = decoder.decode(value, { stream: true });

          chunkIndex++;
          totalChars += chunkText.length;

          // 🔍 Flush log immediately per chunk
          console.log(
            `%c[CHUNK ${chunkIndex}] (${chunkText.length} chars)`,
            "color: #6366f1; font-weight: bold;",
          );
          console.log(chunkText);

          // Append to UI
          summaryEl.textContent += chunkText;
          summaryEl.scrollTop = summaryEl.scrollHeight;

          return pump();
        });
      }

      return pump();
    })
    .catch((err) => {
      console.error("[STREAM ERROR]", err);
      statusEl.textContent = "❌ " + (err.message || "Unknown error");
      statusEl.style.color = "#dc2626";
    });
}

// ─────────────────────────────────────────────────────────────
// Main Execution
// ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const copyBtn = document.getElementById("copy-btn");

  const tabId = getTabIdFromUrl();

  if (!tabId) {
    statusEl.textContent = "❌ Missing tabId in URL";
    statusEl.style.color = "#dc2626";
    return;
  }

  getCurrentTabHTML(tabId)
    .then((html) => {
      if (!html || html.length === 0) {
        throw new Error("Could not retrieve page HTML");
      }
      streamSummary(html, statusEl, summaryEl, copyBtn);
    })
    .catch((err) => {
      console.error(err);
      statusEl.textContent = "❌ " + (err.message || "Unknown error");
      statusEl.style.color = "#dc2626";
    });

  // Copy button handler
  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(summaryEl.textContent).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
    });
  });
});
