// links-tree.js
document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const treeDiv = document.getElementById("tree");
  const btnRefresh = document.getElementById("btn-refresh");
  const chkExternal = document.getElementById("include-external");
  const txtInclude = document.getElementById("include-patterns");
  const txtExclude = document.getElementById("exclude-patterns");

  let currentTabId = null;
  let currentUrl = null;

  function getTabIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("tabId") ? parseInt(params.get("tabId"), 10) : null;
  }

  async function getCurrentTabInfo() {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab?.url) return { id: tab.id, url: tab.url };
    }
    // fallback
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return { id: tab?.id, url: tab?.url };
  }

  function getFilterValues() {
    const includeLines = txtInclude.value
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const excludeLines = txtExclude.value
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const includeSelLines = document
      .getElementById("include-selectors")
      .value.trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const excludeSelLines = document
      .getElementById("exclude-selectors")
      .value.trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    return {
      include_external: chkExternal.checked,
      include_patterns: includeLines.length ? includeLines : undefined,
      exclude_patterns: excludeLines.length ? excludeLines : undefined,
      include_selectors: includeSelLines.length ? includeSelLines : undefined,
      exclude_selectors: excludeSelLines.length ? excludeSelLines : undefined,
    };
  }

  async function fetchAndRender() {
    status.textContent = "Fetching page content...";
    status.style.color = "";

    try {
      const tabInfo = await getCurrentTabInfo();
      if (!tabInfo?.id || !tabInfo.url) throw new Error("No active tab");

      currentTabId = tabInfo.id;
      currentUrl = tabInfo.url;

      if (
        currentUrl.startsWith("chrome://") ||
        currentUrl.startsWith("edge://") ||
        currentUrl.startsWith("opera://") ||
        currentUrl.startsWith("brave://")
      ) {
        throw new Error("Cannot extract links from internal browser pages");
      }

      status.textContent = "Extracting HTML...";

      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => document.documentElement.outerHTML,
      });

      const html = results[0]?.result;
      if (!html) throw new Error("Could not get page HTML");

      status.textContent = "Analyzing links...";

      const filters = getFilterValues();

      const response = await fetch(
        "http://localhost:8000/extract-grouped-links",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: currentUrl,
            html,
            include_external: filters.include_external,
            include_patterns: filters.include_patterns,
            exclude_patterns: filters.exclude_patterns,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Server error ${response.status}`);
      }

      const groups = await response.json();

      renderTree(groups);

      status.textContent = `Found ${groups.reduce((sum, g) => sum + g.links.length, 0)} links in ${groups.length} sections`;
      status.style.color = "#16a34a";
    } catch (err) {
      console.error(err);
      status.textContent = "Error: " + (err.message || "Unknown");
      status.style.color = "#dc2626";
      treeDiv.innerHTML = `<p class="empty">No links could be loaded.</p>`;
    }
  }

  function renderTree(groups) {
    treeDiv.innerHTML = "";

    if (
      !groups?.length ||
      (groups.length === 1 && groups[0].links.length === 0)
    ) {
      treeDiv.innerHTML = `<p class="empty">No links found on this page.</p>`;
      return;
    }

    const ul = document.createElement("ul");

    for (const group of groups) {
      if (group.links.length === 0) continue;

      const li = document.createElement("li");
      li.className = "collapsible";

      const details = document.createElement("details");
      details.open = true; // default open – can change to false if preferred

      const summary = document.createElement("summary");
      summary.textContent = group.context || "Uncategorized";
      details.appendChild(summary);

      const subUl = document.createElement("ul");

      for (const link of group.links) {
        const subLi = document.createElement("li");
        const a = document.createElement("a");
        a.href = link.href;
        a.textContent = link.text || link.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        subLi.appendChild(a);
        subUl.appendChild(subLi);
      }

      details.appendChild(subUl);
      li.appendChild(details);
      ul.appendChild(li);
    }

    treeDiv.appendChild(ul);
  }

  // Init
  currentTabId = getTabIdFromUrl();

  fetchAndRender(); // auto-run on open

  btnRefresh.onclick = fetchAndRender;
});
