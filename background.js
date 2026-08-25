function setBadge(running) {
  chrome.action.setBadgeText({ text: running ? "RUN" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#c5221f" });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ running: false });
  setBadge(false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.running) {
    setBadge(Boolean(changes.running.newValue));
  }
});
