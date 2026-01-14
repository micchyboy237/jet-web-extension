document.addEventListener("DOMContentLoaded", async () => {
  const searchInput = document.getElementById("search");
  const filterSelect = document.getElementById("filter");
  const list = document.getElementById("tabList");
  const heading = document.querySelector("h1");

  let allTabs = [];

  async function loadTabs() {
    allTabs = await chrome.tabs.query({});

    // Sort by most recently active first (optional improvement #2)
    allTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

    renderTabs(allTabs);
  }

  function renderTabs(tabs) {
    list.innerHTML = "";

    tabs.forEach((tab) => {
      const li = document.createElement("li");

      // Tooltip showing window id + hostname (optional improvement #1)
      const hostname = tab.url ? new URL(tab.url).hostname : "—";
      li.title = `Window ${tab.windowId} • ${hostname}`;

      const img = document.createElement("img");
      img.className = "favicon";
      img.src = tab.favIconUrl || "https://via.placeholder.com/16";
      img.onerror = () => {
        img.src = "https://via.placeholder.com/16";
      };

      const div = document.createElement("div");
      div.style.flex = "1";
      div.style.overflow = "hidden";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = tab.title || "Untitled";

      const url = document.createElement("div");
      url.className = "url";
      url.textContent = tab.url;

      div.appendChild(title);
      div.appendChild(url);

      li.appendChild(img);
      li.appendChild(div);

      // Click → switch to tab
      li.onclick = () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      };

      list.appendChild(li);
    });

    // Update total count in heading (optional improvement #3)
    heading.textContent = `Open Tabs (${tabs.length})`;
  }

  function filterTabs() {
    let filtered = [...allTabs];
    const term = searchInput.value.toLowerCase().trim();
    const filter = filterSelect.value;

    if (term) {
      filtered = filtered.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(term) ||
          (t.url || "").toLowerCase().includes(term)
      );
    }

    if (filter === "http") {
      filtered = filtered.filter(
        (t) => t.url.startsWith("http://") || t.url.startsWith("https://")
      );
    } else if (filter === "chrome") {
      filtered = filtered.filter((t) => t.url.startsWith("chrome://"));
    }

    renderTabs(filtered);
  }

  // Initial load
  await loadTabs();

  // Live filtering
  searchInput.addEventListener("input", filterTabs);
  filterSelect.addEventListener("change", filterTabs);
});
