document.addEventListener("DOMContentLoaded", async () => {
    const list = document.getElementById("list");
    const searchInput = document.getElementById("search");
    const timeFilter = document.getElementById("timeRange");
    const unopenedOnly = document.getElementById("onlyUnopened");
    const btnOpen = document.getElementById("btn-open");

    let historyItems = [];
    let openUrls = new Set();

    /* -------------------------------
       URL Normalization
    -------------------------------- */
    function normalizeUrl(rawUrl) {
      try {
        const url = new URL(rawUrl);
        url.hash = '';  // remove fragment
        url.searchParams.sort(); // canonicalize param order
        return url.toString();
      } catch {
        return rawUrl;
      }
    }

    /* -------------------------------
       Helpers
    -------------------------------- */

    function getStartTime(range) {
      const now = Date.now();
      if (range === "1h") return now - 3600_000;
      if (range === "24h") return now - 86400_000;
      if (range === "7d") return now - 604800_000;
      return 0;
    }

    // --- New Helpers for grouping by day

    function getDayLabel(timestamp) {
      const date = new Date(timestamp);
      const today = new Date();
      today.setHours(0,0,0,0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date >= today) return "Today";
      if (date >= yesterday) return "Yesterday";
      return date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
      });
    }

    function groupByDay(items) {
      const groups = {};
      items.forEach(item => {
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
        tabs.map(t => t.url || '').filter(Boolean).map(normalizeUrl)
      );
    }

    function isOpened(url) {
      return openUrls.has(normalizeUrl(url));
    }

    /* -------------------------------
       Rendering
    -------------------------------- */

    function render(items) {
      list.innerHTML = "";

      // console.log("[DEBUG] Rendering items count before filter:", items.length);

      if (items.length === 0) {
        list.innerHTML = '<p style="text-align:center; color: #9ca3af; padding: 40px 0; font-style: italic;">No web pages found in history.</p>';
        return;
      }

      const filtered = items.filter(item => {
        const opened = isOpened(item.url);
        return !unopenedOnly.checked || !opened;
      });

      // console.log("[DEBUG] After unopenedOnly filter:", filtered.length);

      if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align:center; color: #9ca3af; padding: 40px 0;">No matching unopened web pages.</p>';
        return;
      }

      const grouped = groupByDay(filtered);
      // console.log("[DEBUG] Groups created:", grouped.length);

      grouped.forEach(([dayLabel, dayItems]) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "day-group";

        const header = document.createElement("h2");
        header.className = "day-header";
        header.textContent = dayLabel;
        groupDiv.appendChild(header);

        dayItems.forEach(item => {
          const opened = isOpened(item.url);
          const normalized = normalizeUrl(item.url);

          let faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(normalized).hostname) + '&sz=32';
          // Fallback if google favicon fails
          const fallbackIcon = 'https://via.placeholder.com/24/cccccc/ffffff?text=🔗';

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
              <div>${new Date(item.lastVisitTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
              <span class="status-pill ${opened ? 'status-opened' : 'status-unopened'}">
                ${opened ? 'Opened ✓' : 'Not opened'}
              </span>
            </div>
          `;
          groupDiv.appendChild(itemDiv);
        });

        list.appendChild(groupDiv);
      });
    }

    /* -------------------------------
       Load + Filter
    -------------------------------- */

    function _dedupeByLatestVisit(items) {
      // Only keep valid web URLs (http/https)
      const validItems = items.filter(item => 
        item.url && (
          item.url.startsWith('http://') || 
          item.url.startsWith('https://')
        )
      );
      
      const map = new Map();
      for (const item of validItems) {
        const existing = map.get(item.url);
        if (!existing || item.lastVisitTime > existing.lastVisitTime) {
          map.set(item.url, item);
        }
      }
      return Array.from(map.values()).sort(
        (a, b) => b.lastVisitTime - a.lastVisitTime
      );
    }

    function loadHistory() {
      chrome.history.search(
        {
          text: "",
          startTime: 0,
          maxResults: 500,   // increase a bit — helps see more when debugging
        },
        (items) => {
          console.log("[DEBUG] Raw history items count:", items?.length || 0);
          historyItems = _dedupeByLatestVisit(items || []);
          render(historyItems);
        }
      );
    }

    function applyFilters() {
      chrome.history.search(
        {
          text: searchInput.value.trim(),
          startTime: getStartTime(timeFilter.value),
          maxResults: 200,
        },
        (items) => {
          historyItems = _dedupeByLatestVisit(items || []);
          render(historyItems);
        }
      );
    }

    /* -------------------------------
       Events
    -------------------------------- */
    // Removed selectAll event listener

    // Make entire row clickable to toggle checkbox
    list.addEventListener('click', (event) => {
      // Find the nearest .history-item ancestor
      const item = event.target.closest('.history-item');
      if (!item) return;
      // Avoid double-toggle if user clicked the checkbox directly
      if (event.target.tagName === 'INPUT' && event.target.type === 'checkbox') {
        return; // let native checkbox handle it
      }
      // Find the checkbox inside this row
      const checkbox = item.querySelector('.row-check');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        // Optional: trigger change event if other code listens to it
        // checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    btnOpen.onclick = () => {
      const urls = [...document.querySelectorAll(".row-check")]
        .filter((c) => c.checked)
        .map((c) => c.dataset.url);

      // Final defense: normalize + deduplicate before opening
      const uniqueNormalizedUrls = [...new Set(urls.map(normalizeUrl))];

      uniqueNormalizedUrls.forEach((url) => {
        chrome.tabs.create({ url, active: false });
      });
    };

    searchInput.addEventListener("input", applyFilters);
    timeFilter.addEventListener("change", applyFilters);
    unopenedOnly.addEventListener("change", applyFilters);

    /* -------------------------------
       Init
    -------------------------------- */

    await loadOpenTabs();
    loadHistory();
});