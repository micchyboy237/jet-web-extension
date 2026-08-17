document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("list");

  // Form fields matching chrome.history.search query object
  const searchTextInput = document.getElementById("search-text");
  const startTimeInput = document.getElementById("startTime");
  const endTimeInput = document.getElementById("endTime");
  const maxResultsInput = document.getElementById("maxResults");
  const timeRangeSelect = document.getElementById("timeRange");
  const unopenedOnlyCheckbox = document.getElementById("onlyUnopened");

  const btnSearch = document.getElementById("btn-search");
  const btnOpen = document.getElementById("btn-open");
  const btnDownloadJson = document.getElementById("btn-download-json");
  const totalItemsDisplay = document.getElementById("total-items");

  let historyItems = [];
  let openUrls = new Set();
  let currentBatch = 0;
  const batchSize = 20;

  /* URL Normalization */
  function normalizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      url.searchParams.sort();
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  // Find a tab whose normalized url matches the provided url
  async function findTabWithUrl(normalizedUrl) {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url && normalizeUrl(t.url) === normalizedUrl);
  }

  /* Helpers - Convert datetime-local to milliseconds since epoch */
  function dateTimeLocalToMs(dateTimeStr) {
    if (!dateTimeStr) return null;
    const date = new Date(dateTimeStr);
    return isNaN(date.getTime()) ? null : date.getTime();
  }

  /* Get startTime from timeRange preset */
  function getStartTimeFromPreset(range) {
    const now = Date.now();
    if (range === "1h") return now - 3600_000;
    if (range === "24h") return now - 86400_000;
    if (range === "7d") return now - 604800_000;
    if (range === "all") return 0;
    return null; // custom range
  }

  /* Build query object from form fields */
  function buildQueryObject() {
    const query = {
      text: searchTextInput.value.trim(),
      maxResults: parseInt(maxResultsInput.value, 10) || 100,
    };

    // Ensure maxResults is at least 1
    if (query.maxResults < 1) query.maxResults = 1;

    // Handle startTime: use preset or custom input
    const presetStartTime = getStartTimeFromPreset(timeRangeSelect.value);
    const customStartTime = dateTimeLocalToMs(startTimeInput.value);

    if (timeRangeSelect.value === "custom" && customStartTime !== null) {
      query.startTime = customStartTime;
    } else if (presetStartTime !== null) {
      query.startTime = presetStartTime;
    }
    // If neither is set, API defaults to last 24 hours

    // Handle endTime: only if custom end time is provided
    const customEndTime = dateTimeLocalToMs(endTimeInput.value);
    if (customEndTime !== null) {
      query.endTime = customEndTime;
    }

    return query;
  }

  // Group by day
  function getDayLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date >= today) return "Today";
    if (date >= yesterday) return "Yesterday";

    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  }

  function groupByDay(items) {
    const groups = {};
    items.forEach((item) => {
      const label = getDayLabel(item.lastVisitTime);
      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    });

    // Sort days (Today/Yesterday first, then newest → oldest)
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === "Today") return -1;
      if (b[0] === "Today") return 1;
      if (a[0] === "Yesterday") return -1;
      if (b[0] === "Yesterday") return 1;
      return b[1][0].lastVisitTime - a[1][0].lastVisitTime;
    });
  }

  async function loadOpenTabs() {
    const tabs = await chrome.tabs.query({});
    openUrls = new Set(
      tabs
        .map((t) => t.url || "")
        .filter(Boolean)
        .map(normalizeUrl),
    );
  }

  function isOpened(url) {
    return openUrls.has(normalizeUrl(url));
  }

  /* Rendering */
  function render(items) {
    list.innerHTML = "";

    if (items.length === 0) {
      list.innerHTML =
        '<p style="text-align:center; color: #9ca3af; padding: 40px 0; font-style: italic;">No web pages found in history.</p>';
      return;
    }

    const filtered = items.filter((item) => {
      const opened = isOpened(item.url);
      return !unopenedOnlyCheckbox.checked || !opened;
    });

    if (filtered.length === 0) {
      list.innerHTML =
        '<p style="text-align:center; color: #9ca3af; padding: 40px 0;">No matching unopened web pages.</p>';
      return;
    }

    // Reset batch for new search
    currentBatch = 0;
    loadNextBatch(filtered);
  }

  function loadNextBatch(items) {
    const startIndex = currentBatch * batchSize;
    const endIndex = startIndex + batchSize;
    const batchItems = items.slice(startIndex, endIndex);

    if (batchItems.length === 0) return;

    const grouped = groupByDay(batchItems);

    grouped.forEach(([dayLabel, dayItems]) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "day-group";

      // Only add day header if it's the first batch or a new day
      if (
        startIndex === 0 ||
        !document.querySelector(`.day-header:contains("${dayLabel}")`)
      ) {
        const header = document.createElement("h2");
        header.className = "day-header";
        header.textContent = dayLabel;
        groupDiv.appendChild(header);
      }

      dayItems.forEach((item) => {
        const opened = isOpened(item.url);
        const normalized = normalizeUrl(item.url);

        let faviconUrl =
          "https://www.google.com/s2/favicons?domain=" +
          encodeURIComponent(new URL(normalized).hostname) +
          "&sz=32";

        const fallbackIcon =
          "https://via.placeholder.com/24/cccccc/ffffff?text=🔗";

        const itemDiv = document.createElement("div");
        itemDiv.className = "history-item";
        itemDiv.innerHTML = `
          <div class="checkbox-col">
            <input type="checkbox" class="row-check" data-url="${item.url}">
          </div>
          <div class="favicon-col">
            <img class="favicon"
                 src="${faviconUrl}"
                 onerror="this.src='${fallbackIcon}'; this.onerror=null;"
                 alt="favicon">
          </div>
          <div class="item-content">
            <div class="item-title">${item.title || "Untitled"}</div>
            <div class="item-url">${item.url}</div>
          </div>
          <div class="meta">
            <div>${new Date(item.lastVisitTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <span class="status-pill ${opened ? "status-opened" : "status-unopened"}">
              ${opened ? "Opened ✓" : "Not opened"}
            </span>
          </div>
          <button class="go-btn ${opened ? "opened" : ""}"
                  title="${opened ? "Switch to open tab" : "Open in new tab"}"
                  data-url="${item.url}">
            ${opened ? "→" : "↗"}
          </button>
        `;
        groupDiv.appendChild(itemDiv);
      });

      list.appendChild(groupDiv);
    });

    currentBatch++;
    updateTotalItems(items.length);
  }

  // Infinite scroll
  list.addEventListener("scroll", () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 10) {
      const filtered = historyItems.filter((item) => {
        const opened = isOpened(item.url);
        return !unopenedOnlyCheckbox.checked || !opened;
      });
      loadNextBatch(filtered);
    }
  });

  function updateTotalItems(count) {
    totalItemsDisplay.textContent = `Found: ${count} items`;
  }

  /* Load + Filter */
  function _dedupeByLatestVisit(items) {
    const validItems = items.filter(
      (item) =>
        item.url &&
        (item.url.startsWith("http://") || item.url.startsWith("https://")),
    );

    const map = new Map();
    for (const item of validItems) {
      const existing = map.get(item.url);
      if (!existing || item.lastVisitTime > existing.lastVisitTime) {
        map.set(item.url, item);
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.lastVisitTime - a.lastVisitTime,
    );
  }

  /* Main search function using query object from form */
  async function performSearch() {
    const query = buildQueryObject();

    console.log("Searching with query:", query);

    try {
      const items = await chrome.history.search(query);
      historyItems = _dedupeByLatestVisit(items || []);
      render(historyItems);
    } catch (error) {
      console.error("Error searching history:", error);
      list.innerHTML = `<p style="text-align:center; color: #ef4444; padding: 40px 0;">Error: ${error.message}</p>`;
    }
  }

  /* Events */
  // Search button click
  btnSearch.onclick = performSearch;

  // Also trigger search on Enter key in text input
  searchTextInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      performSearch();
    }
  });

  // Update custom inputs when timeRange changes
  timeRangeSelect.addEventListener("change", () => {
    if (timeRangeSelect.value !== "custom") {
      // Clear custom datetime inputs when using preset
      startTimeInput.value = "";
      endTimeInput.value = "";
    }
  });

  // Handle "go to / open" button clicks (delegated)
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest(".go-btn");
    if (!btn) return;

    const url = btn.dataset.url;
    const normalized = normalizeUrl(url);
    const existingTab = await findTabWithUrl(normalized);

    if (existingTab) {
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, active: false });
    }
  });

  // Make entire row clickable to toggle checkbox
  list.addEventListener("click", (event) => {
    const item = event.target.closest(".history-item");
    if (!item) return;
    if (event.target.closest(".go-btn")) return;
    if (event.target.tagName === "INPUT" && event.target.type === "checkbox") {
      return;
    }

    const checkbox = item.querySelector(".row-check");
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
    }
  });

  btnOpen.onclick = () => {
    const urls = [...document.querySelectorAll(".row-check")]
      .filter((c) => c.checked)
      .map((c) => c.dataset.url);

    const uniqueNormalizedUrls = [...new Set(urls.map(normalizeUrl))];
    uniqueNormalizedUrls.forEach((url) => {
      chrome.tabs.create({ url, active: false });
    });
  };

  // Download as JSON
  btnDownloadJson.onclick = () => {
    const jsonData = JSON.stringify(historyItems, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "history_search_results.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Init */
  await loadOpenTabs();

  // Initial search with default query (All time)
  performSearch();

  // Refresh open tabs status when tabs change
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      await loadOpenTabs();
      render(historyItems);
    }
  });

  chrome.tabs.onRemoved.addListener(async () => {
    await loadOpenTabs();
    render(historyItems);
  });
});
