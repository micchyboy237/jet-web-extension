document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("search");
  const typeFilter = document.getElementById("typeFilter");
  const statusFilter = document.getElementById("statusFilter");
  const btnClear = document.getElementById("btn-clear");
  const tbody = document.getElementById("requestList");

  let allRequests = [];

  async function loadRequests() {
    const response = await chrome.runtime.sendMessage({
      action: "getNetworkHistory",
    });
    allRequests = response.history || [];
    renderRequests(allRequests);
  }

  function renderRequests(requests) {
    tbody.innerHTML = "";

    requests.forEach((req) => {
      const tr = document.createElement("tr");

      const timeTd = document.createElement("td");
      timeTd.className = "time-col";
      timeTd.textContent = new Date(req.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const methodTd = document.createElement("td");
      methodTd.className = `method-${req.method.toLowerCase()}`;
      methodTd.textContent = req.method;

      const statusTd = document.createElement("td");
      let statusClass = "";
      if (req.status === "ERROR") statusClass = "status-err";
      else if (req.status >= 200 && req.status < 300) statusClass = "status-ok";
      else if (req.status >= 400) statusClass = "status-err";
      statusTd.className = statusClass;
      statusTd.textContent = req.status ?? "—";

      const typeTd = document.createElement("td");
      typeTd.textContent = req.type;

      const urlTd = document.createElement("td");
      urlTd.className = "url-col";
      urlTd.textContent = req.url;

      const initTd = document.createElement("td");
      initTd.textContent = req.initiator
        ? new URL(req.initiator).hostname
        : "—";

      tr.append(timeTd, methodTd, statusTd, typeTd, urlTd, initTd);
      tbody.appendChild(tr);
    });
  }

  function filterRequests() {
    let filtered = [...allRequests];

    const term = searchInput.value.toLowerCase().trim();
    if (term) {
      filtered = filtered.filter(
        (r) =>
          r.url.toLowerCase().includes(term) ||
          (r.initiator || "").toLowerCase().includes(term)
      );
    }

    const typeVal = typeFilter.value;
    if (typeVal !== "all") {
      filtered = filtered.filter((r) => r.type === typeVal);
    }

    const statusVal = statusFilter.value;
    if (statusVal !== "all") {
      if (statusVal === "2xx") {
        filtered = filtered.filter((r) => r.status >= 200 && r.status < 300);
      } else if (statusVal === "3xx") {
        filtered = filtered.filter((r) => r.status >= 300 && r.status < 400);
      } else if (statusVal === "4xx") {
        filtered = filtered.filter((r) => r.status >= 400 && r.status < 500);
      } else if (statusVal === "5xx") {
        filtered = filtered.filter((r) => r.status >= 500 && r.status < 600);
      } else if (statusVal === "ERROR") {
        filtered = filtered.filter((r) => r.status === "ERROR");
      }
    }

    renderRequests(filtered);
  }

  // Initial load
  loadRequests();

  // Live filtering
  searchInput.addEventListener("input", filterRequests);
  typeFilter.addEventListener("change", filterRequests);
  statusFilter.addEventListener("change", filterRequests);

  // Clear history
  btnClear.onclick = async () => {
    if (confirm("Clear all network history?")) {
      await chrome.runtime.sendMessage({ action: "clearNetworkHistory" });
      allRequests = [];
      renderRequests([]);
    }
  };

  // Optional: auto refresh every 2 seconds
  setInterval(loadRequests, 2000);
});
