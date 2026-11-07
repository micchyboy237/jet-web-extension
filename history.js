document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("list");
  const paginationContainer = document.getElementById("pagination");
  // Form fields matching chrome.history.search query object
  const searchTextInput = document.getElementById("search-text");
  const hostFilterInput = document.getElementById("host-filter");
  const hostDropdown = document.getElementById("host-dropdown");
  const startTimeInput = document.getElementById("startTime");
  const endTimeInput = document.getElementById("endTime");
  const maxResultsInput = document.getElementById("maxResults");
  const minVisitCountInput = document.getElementById("minVisitCount");
  const maxVisitCountInput = document.getElementById("maxVisitCount");
  const timeRangeSelect = document.getElementById("timeRange");
  const uniqueByPathCheckbox = document.getElementById("uniqueByPath");
  const openStatusRadios = document.querySelectorAll(
    'input[name="openStatus"]',
  );
  const sortBySelect = document.getElementById("sortBy");
  const sortOrderSelect = document.getElementById("sortOrder");
  // New UI Elements
  const clearStartBtn = document.getElementById("clear-start");
  const clearEndBtn = document.getElementById("clear-end");
  const startTimeWrapper = document.getElementById("start-time-wrapper");
  const endTimeWrapper = document.getElementById("end-time-wrapper");
  const btnCheckAll = document.getElementById("btn-check-all");
  const btnClearAll = document.getElementById("btn-clear-all");
  const btnSearch = document.getElementById("btn-search");
  const btnOpen = document.getElementById("btn-open");
  const btnDownloadJson = document.getElementById("btn-download-json");
  const btnCopyJson = document.getElementById("btn-copy-json");
  const totalItemsDisplay = document.getElementById("total-items");

  let historyItems = [];
  let filteredItems = [];
  let openUrls = new Set();

  // Pagination State
  const ITEMS_PER_PAGE = 50;
  let currentPage = 1;

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

    // Split into date and time parts
    const [datePart, timePart] = dateTimeStr.split("T");
    if (!datePart || !timePart) return null;

    const [year, month, day] = datePart.split("-").map(Number);
    const timeParts = timePart.split(":");

    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;
    const ms = timeParts.length > 3 ? parseInt(timeParts[3], 10) : 0;

    if (
      isNaN(year) ||
      isNaN(month) ||
      isNaN(day) ||
      isNaN(hour) ||
      isNaN(minute)
    ) {
      return null;
    }

    // CRITICAL: Use the constructor that takes individual components to ensure
    // the browser treats it as LOCAL time, not UTC.
    const date = new Date(year, month - 1, day, hour, minute, second, ms);
    const timeMs = date.getTime();

    if (isNaN(timeMs)) return null;
    return timeMs;
  }

  /* Get startTime from timeRange preset */
  function getStartTimeFromPreset(range) {
    const now = Date.now();
    if (range === "1h") return now - 3600_000;
    if (range === "24h") return now - 86400_000;
    if (range === "7d") return now - 604800_000;
    if (range === "all") return 0;
    return null;
  }

  /* Update Clear Button Visibility */
  function updateClearButtonVisibility() {
    if (startTimeInput.value) {
      startTimeWrapper.classList.add("has-value");
    } else {
      startTimeWrapper.classList.remove("has-value");
    }
    if (endTimeInput.value) {
      endTimeWrapper.classList.add("has-value");
    } else {
      endTimeWrapper.classList.remove("has-value");
    }
  }

  /* Build query object from form fields */
  function buildQueryObject() {
    const query = {
      text: searchTextInput.value.trim(),
      maxResults: parseInt(maxResultsInput.value, 10) || 1000,
    };

    if (query.maxResults < 1) query.maxResults = 1;
    if (query.maxResults > 10000) query.maxResults = 10000;

    const presetStartTime = getStartTimeFromPreset(timeRangeSelect.value);
    const customStartTime = dateTimeLocalToMs(startTimeInput.value);
    const customEndTime = dateTimeLocalToMs(endTimeInput.value);

    // Determine effective start time
    // Priority: Custom Start > Preset Start > 0 (All time) if Custom End is present
    if (customStartTime !== null) {
      query.startTime = customStartTime;
    } else if (timeRangeSelect.value !== "custom" && presetStartTime !== null) {
      query.startTime = presetStartTime;
    } else if (customEndTime !== null) {
      // If user picks an End Date but no Start Date, assume they want to see
      // everything up to that date, not just the last 24 hours before that date.
      query.startTime = 0;
    }

    // Determine effective end time
    if (customEndTime !== null) {
      query.endTime = customEndTime;
    }

    // Safety check: Ensure start is not after end
    if (query.startTime !== undefined && query.endTime !== undefined) {
      if (query.startTime > query.endTime) {
        console.warn(
          "[Query] Start time is after End time. Adjusting Start to 0.",
        );
        query.startTime = 0;
      }
    }

    console.log("[Query] Built Query Object:", JSON.stringify(query, null, 2));
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

  /* Formatting helpers */
  function formatDateTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatVisitStats(item) {
    const parts = [];
    if (item.visitCount != null) {
      parts.push(`${item.visitCount} visit${item.visitCount !== 1 ? "s" : ""}`);
    }
    if (item.typedCount != null && item.typedCount > 0) {
      parts.push(`${item.typedCount} typed`);
    }
    return parts.length > 0 ? parts.join(", ") : "";
  }

  /* Sorting function */
  function sortItems(items, sortBy, sortOrder) {
    const sorted = [...items];
    const multiplier = sortOrder === "asc" ? 1 : -1;
    if (sortBy === "datetime") {
      sorted.sort((a, b) => {
        const timeA = a.lastVisitTime || 0;
        const timeB = b.lastVisitTime || 0;
        return (timeA - timeB) * multiplier;
      });
    } else if (sortBy === "visitCount") {
      sorted.sort((a, b) => {
        const countA = a.visitCount || 0;
        const countB = b.visitCount || 0;
        return (countA - countB) * multiplier;
      });
    }
    return sorted;
  }

  /* Centralized Filtering Logic */
  function getFilteredAndSortedItems(items) {
    const openStatus = getSelectedOpenStatus();
    const hostFilter = hostFilterInput.value.trim().toLowerCase();
    const minVisitCount = minVisitCountInput.value
      ? parseInt(minVisitCountInput.value, 10)
      : null;
    const maxVisitCount = maxVisitCountInput.value
      ? parseInt(maxVisitCountInput.value, 10)
      : null;
    const sortBy = sortBySelect.value;
    const sortOrder = sortOrderSelect.value;

    const customStartTime = dateTimeLocalToMs(startTimeInput.value);
    const customEndTime = dateTimeLocalToMs(endTimeInput.value);
    const presetStartTime = getStartTimeFromPreset(timeRangeSelect.value);

    let effectiveStartTime = null;
    if (customStartTime !== null) {
      effectiveStartTime = customStartTime;
    } else if (timeRangeSelect.value !== "custom" && presetStartTime !== null) {
      effectiveStartTime = presetStartTime;
    }

    let effectiveEndTime = null;
    if (customEndTime !== null) {
      effectiveEndTime = customEndTime;
    }

    let filtered = items.filter((item) => {
      const opened = isOpened(item.url);
      if (openStatus === "opened" && !opened) return false;
      if (openStatus === "unopened" && opened) return false;

      if (hostFilter) {
        const hostname = getHostname(item.url).toLowerCase();
        if (!hostname.includes(hostFilter)) return false;
      }

      if (
        minVisitCount !== null &&
        item.visitCount != null &&
        item.visitCount < minVisitCount
      ) {
        return false;
      }
      if (
        maxVisitCount !== null &&
        item.visitCount != null &&
        item.visitCount > maxVisitCount
      ) {
        return false;
      }

      if (
        effectiveStartTime !== null &&
        item.lastVisitTime < effectiveStartTime
      ) {
        return false;
      }

      if (effectiveEndTime !== null && item.lastVisitTime > effectiveEndTime) {
        return false;
      }

      return true;
    });

    filtered = sortItems(filtered, sortBy, sortOrder);
    return filtered;
  }

  /* Rendering */
  function render(items) {
    list.innerHTML = "";
    paginationContainer.innerHTML = "";

    filteredItems = getFilteredAndSortedItems(items);

    if (filteredItems.length === 0) {
      let message = "No web pages found.";
      if (items.length > 0) {
        message = "No matching web pages with current filters.";
      }
      list.innerHTML = `<p style="text-align:center; color: #9ca3af; padding: 40px 0; font-style: italic;">${message}</p>`;
      updateTotalItems(filteredItems.length);
      return;
    }

    currentPage = 1;
    renderPage();
  }

  function renderPage() {
    list.innerHTML = "";
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageItems = filteredItems.slice(startIndex, endIndex);

    if (pageItems.length === 0) {
      list.innerHTML = `<p style="text-align:center; color: #9ca3af; padding: 40px 0;">No items on this page.</p>`;
      return;
    }

    const grouped = groupByDay(pageItems);
    grouped.forEach(([dayLabel, dayItems]) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "day-group";

      const header = document.createElement("h2");
      header.className = "day-header";
      header.textContent = dayLabel;
      groupDiv.appendChild(header);

      dayItems.forEach((item) => {
        const opened = isOpened(item.url);
        const normalized = normalizeUrl(item.url);
        let faviconUrl =
          "https://www.google.com/s2/favicons?domain=" +
          encodeURIComponent(new URL(normalized).hostname) +
          "&sz=32";
        const fallbackIcon =
          "https://via.placeholder.com/24/cccccc/ffffff?text=🔗";

        const visitDate = formatDateTime(item.lastVisitTime);
        const visitStats = formatVisitStats(item);

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
            ${visitDate ? `<div class="visit-date">${visitDate}</div>` : ""}
            ${visitStats ? `<div class="visit-stats">${visitStats}</div>` : ""}
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

    updateTotalItems(filteredItems.length);
    renderPaginationControls();
  }

  function renderPaginationControls() {
    paginationContainer.innerHTML = "";
    const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);

    if (totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.className = "page-btn";
    prevBtn.textContent = "Previous";
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        renderPage();
        list.scrollTop = 0;
      }
    };
    paginationContainer.appendChild(prevBtn);

    const pageInfo = document.createElement("span");
    pageInfo.className = "page-info";
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    paginationContainer.appendChild(pageInfo);

    const nextBtn = document.createElement("button");
    nextBtn.className = "page-btn";
    nextBtn.textContent = "Next";
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderPage();
        list.scrollTop = 0;
      }
    };
    paginationContainer.appendChild(nextBtn);
  }

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

  function deduplicateItems(items) {
    if (uniqueByPathCheckbox.checked) {
      return _dedupeByUrlPath(items);
    } else {
      return _dedupeByLatestVisit(items);
    }
  }

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
    console.log("[Search] Sending query to chrome.history.search...");

    try {
      const items = await chrome.history.search(query);
      console.log(`[Search] API returned ${items?.length || 0} items.`);

      if (items && items.length > 0) {
        console.log("[Search] First item example:", items[0]);
      }

      historyItems = deduplicateItems(items || []);
      console.log(
        `[Search] After deduplication: ${historyItems.length} items.`,
      );

      availableHosts = extractUniqueHosts(historyItems);

      render(historyItems);
    } catch (error) {
      console.error("[Search] Error searching history:", error);
      list.innerHTML = `<p style="text-align:center; color: #ef4444; padding: 40px 0;">Error: ${error.message}</p>`;
    }
  }

  /* Events */
  btnSearch.onclick = performSearch;

  searchTextInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      performSearch();
    }
  });

  function handleDateInputChange() {
    updateClearButtonVisibility();
    if (startTimeInput.value || endTimeInput.value) {
      timeRangeSelect.value = "custom";
    }
    if (historyItems.length > 0) {
      performSearch();
    }
  }

  startTimeInput.addEventListener("input", handleDateInputChange);
  endTimeInput.addEventListener("input", handleDateInputChange);

  clearStartBtn.addEventListener("click", () => {
    startTimeInput.value = "";
    updateClearButtonVisibility();
    if (!endTimeInput.value && timeRangeSelect.value === "custom") {
      timeRangeSelect.value = "all";
    }
    performSearch();
  });

  clearEndBtn.addEventListener("click", () => {
    endTimeInput.value = "";
    updateClearButtonVisibility();
    if (!startTimeInput.value && timeRangeSelect.value === "custom") {
      timeRangeSelect.value = "all";
    }
    performSearch();
  });

  timeRangeSelect.addEventListener("change", () => {
    if (timeRangeSelect.value !== "custom") {
      startTimeInput.value = "";
      endTimeInput.value = "";
      updateClearButtonVisibility();
      performSearch();
    } else {
      if (historyItems.length > 0) {
        render(historyItems);
      }
    }
  });

  uniqueByPathCheckbox.addEventListener("change", () => {
    if (historyItems.length > 0) {
      performSearch();
    }
  });

  openStatusRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (historyItems.length > 0) {
        render(historyItems);
      }
    });
  });

  hostFilterInput.addEventListener("input", () => {
    const query = hostFilterInput.value.trim();
    const matches = filterHosts(query);
    showHostDropdown(matches);
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
    setTimeout(() => {
      hideHostDropdown();
    }, 200);
  });

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

  minVisitCountInput.addEventListener("input", () => {
    if (historyItems.length > 0) {
      render(historyItems);
    }
  });

  maxVisitCountInput.addEventListener("input", () => {
    if (historyItems.length > 0) {
      render(historyItems);
    }
  });

  maxResultsInput.addEventListener("input", () => {
    let value = parseInt(maxResultsInput.value, 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 10000) value = 10000;
    maxResultsInput.value = value;
    performSearch();
  });

  maxResultsInput.addEventListener("change", () => {
    let value = parseInt(maxResultsInput.value, 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 10000) value = 10000;
    maxResultsInput.value = value;
    performSearch();
  });

  sortBySelect.addEventListener("change", () => {
    if (historyItems.length > 0) {
      render(historyItems);
    }
  });

  sortOrderSelect.addEventListener("change", () => {
    if (historyItems.length > 0) {
      render(historyItems);
    }
  });

  btnCheckAll.addEventListener("click", () => {
    const checkboxes = document.querySelectorAll(".row-check");
    checkboxes.forEach((cb) => (cb.checked = true));
  });

  btnClearAll.addEventListener("click", () => {
    const checkboxes = document.querySelectorAll(".row-check");
    checkboxes.forEach((cb) => (cb.checked = false));
  });

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

  btnDownloadJson.onclick = () => {
    const jsonData = JSON.stringify(filteredItems, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "history_search_results.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  btnCopyJson.onclick = async () => {
    try {
      const dataToCopy = filteredItems.map((item) => ({
        title: item.title || "Untitled",
        url: item.url,
        lastVisitTime: item.lastVisitTime,
        lastVisitTimeISO: item.lastVisitTime
          ? new Date(item.lastVisitTime).toISOString()
          : null,
        visitCount: item.visitCount,
        typedCount: item.typedCount,
      }));
      const jsonString = JSON.stringify(dataToCopy, null, 2);
      await navigator.clipboard.writeText(jsonString);
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
  updateClearButtonVisibility();
  performSearch();

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
