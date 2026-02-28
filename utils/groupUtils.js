async function groupTabsByDomain() {
  const tabs = await chrome.tabs.query({});
  const groups = new Map();

  for (const tab of tabs) {
    if (!tab.url?.startsWith("http")) continue;

    const hostname = new URL(tab.url).hostname;
    if (!groups.has(hostname)) {
      groups.set(hostname, []);
    }
    groups.get(hostname).push(tab.id);
  }

  for (const [hostname, tabIds] of groups) {
    if (tabIds.length < 2) continue; // optional

    const newWindow = await chrome.windows.create({
      tabId: tabIds[0],
      focused: false,
    });

    if (tabIds.length > 1) {
      await chrome.tabs.move(tabIds.slice(1), {
        windowId: newWindow.id,
        index: -1,
      });
    }
  }
}
