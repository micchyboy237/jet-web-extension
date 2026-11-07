document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("list");
  // Form fields matching chrome.history.search query object
  const searchTextInput = document.getElementById("search-text");
  const hostFilterInput = document.getElementById("host-filter");
  const hostDropdown = document.getElementById("host-dropdown");
  const startTimeInput = document.getElementById("startTime");
  const endTimeInput = document.getElementById("endTime");
  const maxResultsInput = document.getElementById("maxResults");
  const timeRangeSelect = document.getElementById("timeRange");
  const uniqueByPathCheckbox = document.getElementById("uniqueByPath");
  const openStatusRadios = document.querySelectorAll(
    'input[name="openStatus"]',
  );
  const btnSearch = document.getElementById("btn-search");
  const btnOpen = document.getElementById("btn-open");
  const btnDownloadJson = document.getElementById("btn-download-json");
  const btnCopyJson = document.getElementById("btn-copy-json");
  const totalItemsDisplay = document.getElementById("total-items");
  let historyItems = [];
  let openUrls = new Set();
  let currentBatch = 0;
  const batchSize = 20;
  let availableHosts = [];
  let selectedHostIndex = -1;
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
  /* Extract URL path without query params and hash */
  function getUrlPath(rawUrl) {
    try {
      const url = new URL(rawUrl);
      // Return protocol + hostname + pathname (no query params, no hash)
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch {
      return rawUrl;
    }
  }
  /* Extract hostname from URL */
  function getHostname(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.hostname;
    } catch {
      return "";
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
  /* Get selected open status from radio buttons */
  function getSelectedOpenStatus() {
    const selected = document.querySelector('input[name="openStatus"]:checked');
    return selected ? selected.value : "all";
  }
  /* Rendering */
  function render(items) {
    list.innerHTML = "";
    const openStatus = getSelectedOpenStatus();
    const hostFilter = hostFilterInput.value.trim().toLowerCase();

    const filtered = items.filter((item) => {
      const opened = isOpened(item.url);

      // Filter by open status
      if (openStatus === "opened" && !opened) return false;
      if (openStatus === "unopened" && opened) return false;

      // Filter by hostname
      if (hostFilter) {
        const hostname = getHostname(item.url).toLowerCase();
        if (!hostname.includes(hostFilter)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      let message = "No web pages found.";
      if (items.length > 0) {
        message = "No matching web pages with current filters.";
      }
      list.innerHTML = `<p style="text-align:center; color: #9ca3af; padding: 40px 0; font-style: italic;">${message}</p>`;
      updateTotalItems(filtered.length);
      return;
    }

    // Reset batch for new search/filter
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
      const openStatus = getSelectedOpenStatus();
      const hostFilter = hostFilterInput.value.trim().toLowerCase();

      const filtered = historyItems.filter((item) => {
        const opened = isOpened(item.url);

        // Filter by open status
        if (openStatus === "opened" && !opened) return false;
        if (openStatus === "unopened" && opened) return false;

        // Filter by hostname
        if (hostFilter) {
          const hostname = getHostname(item.url).toLowerCase();
          if (!hostname.includes(hostFilter)) return false;
        }

        return true;
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
  /* Deduplicate by URL path (without query params and hash) */
  function _dedupeByUrlPath(items) {
    const validItems = items.filter(
      (item) =>
        item.url &&
        (item.url.startsWith("http://") || item.url.startsWith("https://")),
    );
    const map = new Map();
    for (const item of validItems) {
      const urlPath = getUrlPath(item.url);
      const existing = map.get(urlPath);
      if (!existing || item.lastVisitTime > existing.lastVisitTime) {
        map.set(urlPath, item);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.lastVisitTime - a.lastVisitTime,
    );
  }
  /* Main deduplication function based on toggle state */
  function deduplicateItems(items) {
    if (uniqueByPathCheckbox.checked) {
      return _dedupeByUrlPath(items);
    } else {
      return _dedupeByLatestVisit(items);
    }
  }
  /* Extract unique hosts from history items */
  function extractUniqueHosts(items) {
    const hosts = new Set();
    items.forEach((item) => {
      const hostname = getHostname(item.url);
      if (hostname) {
        hosts.add(hostname);
      }
    });
    return Array.from(hosts).sort();
  }
  /* Autocomplete functionality for host filter */
  function showHostDropdown(matches) {
    hostDropdown.innerHTML = "";
    if (matches.length === 0) {
      hostDropdown.classList.remove("visible");
      return;
    }
    matches.forEach((host, index) => {
      const div = document.createElement("div");
      div.className = "autocomplete-item";
      div.textContent = host;
      div.dataset.index = index;
      div.addEventListener("click", () => {
        hostFilterInput.value = host;
        hostDropdown.classList.remove("visible");
        selectedHostIndex = -1;
        render(historyItems);
      });
      hostDropdown.appendChild(div);
    });
    hostDropdown.classList.add("visible");
    selectedHostIndex = -1;
  }
  function hideHostDropdown() {
    hostDropdown.classList.remove("visible");
    selectedHostIndex = -1;
  }
  function filterHosts(query) {
    if (!query) return availableHosts;
    const lowerQuery = query.toLowerCase();
    return availableHosts.filter((host) =>
      host.toLowerCase().includes(lowerQuery),
    );
  }
  /* Main search function using query object from form */
  async function performSearch() {
    const query = buildQueryObject();
    console.log("Searching with query:", query);
    console.log("Unique by path:", uniqueByPathCheckbox.checked);
    try {
      const items = await chrome.history.search(query);
      historyItems = deduplicateItems(items || []);
      // Extract and cache available hosts
      availableHosts = extractUniqueHosts(historyItems);
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
  // Re-deduplicate and re-render when uniqueByPath toggle changes
  uniqueByPathCheckbox.addEventListener("change", () => {
    if (historyItems.length > 0) {
      // Re-fetch from original API results would be ideal, but for now re-run search
      performSearch();
    }
  });
  // Handle radio button changes for open status - automatically filter
  openStatusRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (historyItems.length > 0) {
        render(historyItems);
      }
    });
  });
  // Host filter input with autocomplete
  hostFilterInput.addEventListener("input", () => {
    const query = hostFilterInput.value.trim();
    const matches = filterHosts(query);
    showHostDropdown(matches);
    // Auto-filter as user types
    if (historyItems.length > 0) {
      render(historyItems);
    }
  });
  hostFilterInput.addEventListener("focus", () => {
    const query = hostFilterInput.value.trim();
    const matches = filterHosts(query);
    if (matches.length > 0) {
      showHostDropdown(matches);
    }
  });
  hostFilterInput.addEventListener("blur", () => {
    // Delay hiding to allow click events on dropdown
    setTimeout(() => {
      hideHostDropdown();
    }, 200);
  });
  // Keyboard navigation for autocomplete
  hostFilterInput.addEventListener("keydown", (e) => {
    const dropdownItems = hostDropdown.querySelectorAll(".autocomplete-item");
    if (
      !hostDropdown.classList.contains("visible") ||
      dropdownItems.length === 0
    ) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedHostIndex = Math.min(
        selectedHostIndex + 1,
        dropdownItems.length - 1,
      );
      updateSelectedHost(dropdownItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedHostIndex = Math.max(selectedHostIndex - 1, 0);
      updateSelectedHost(dropdownItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedHostIndex >= 0 && selectedHostIndex < dropdownItems.length) {
        const selectedItem = dropdownItems[selectedHostIndex];
        hostFilterInput.value = selectedItem.textContent;
        hideHostDropdown();
        if (historyItems.length > 0) {
          render(historyItems);
        }
      }
    } else if (e.key === "Escape") {
      hideHostDropdown();
    }
  });
  function updateSelectedHost(dropdownItems) {
    dropdownItems.forEach((item, index) => {
      if (index === selectedHostIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }
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
  // Copy JSON to clipboard
  btnCopyJson.onclick = async () => {
    try {
      // Create array of objects with title and url
      const dataToCopy = historyItems.map((item) => ({
        title: item.title || "Untitled",
        url: item.url,
      }));
      const jsonString = JSON.stringify(dataToCopy, null, 2);
      // Use navigator.clipboard.writeText which works in extension contexts with clipboardWrite permission
      await navigator.clipboard.writeText(jsonString);
      // Show temporary feedback
      const originalText = btnCopyJson.textContent;
      btnCopyJson.textContent = "Copied!";
      setTimeout(() => {
        btnCopyJson.textContent = originalText;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      alert(
        "Failed to copy to clipboard. Please ensure clipboardWrite permission is granted.",
      );
    }
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
