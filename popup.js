const PHOTOS_ORIGIN = "https://photos.google.com";

const heading = document.getElementById("heading");
const subtitle = document.getElementById("subtitle");
const openPhotos = document.getElementById("openPhotos");
const hideHighlightsRow = document.getElementById("hideHighlightsRow");
const hideHighlightsLabel = document.getElementById("hideHighlightsLabel");
const hideHighlightsToggle = document.getElementById("hideHighlights");
const hideRow = document.getElementById("hideRow");
const hideLabel = document.getElementById("hideLabel");
const hideToggle = document.getElementById("hideNonConsuming");
const selectOccupying = document.getElementById("selectOccupying");
const deleteOccupying = document.getElementById("deleteOccupying");
const deleteAll = document.getElementById("deleteAll");
const stop = document.getElementById("stop");
const hint = document.getElementById("hint");
const stats = document.getElementById("stats");

document.title = gpsfMsg("extName");
heading.textContent = gpsfMsg("extName");
subtitle.textContent = gpsfMsg("popupSubtitle");
openPhotos.textContent = gpsfMsg("openPhotos");
document.getElementById("openPhotosDesc").textContent = gpsfMsg("openPhotosDesc");
hideHighlightsLabel.textContent = gpsfMsg("hideHighlights");
document.getElementById("hideHighlightsDesc").textContent = gpsfMsg("hideHighlightsDesc");
hideLabel.textContent = gpsfMsg("hideNonConsuming");
document.getElementById("hideNonConsumingDesc").textContent = gpsfMsg("hideNonConsumingDesc");
selectOccupying.textContent = gpsfMsg("selectOccupying");
document.getElementById("selectOccupyingDesc").textContent = gpsfMsg("selectOccupyingDesc");
deleteOccupying.textContent = gpsfMsg("deleteOccupying");
document.getElementById("deleteOccupyingDesc").textContent = gpsfMsg("deleteOccupyingDesc");
deleteAll.textContent = gpsfMsg("deleteAll");
document.getElementById("deleteAllDesc").textContent = gpsfMsg("deleteAllDesc");
stop.textContent = gpsfMsg("stop");

function msg(key, substitutions) {
  return gpsfMsg(key, substitutions);
}

function isPhotosUrl(url) {
  return typeof url === "string" && url.startsWith(PHOTOS_ORIGIN);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

function setActionsEnabled(onPhotos, running) {
  hideHighlightsRow.classList.toggle("is-disabled", !onPhotos);
  hideHighlightsToggle.disabled = !onPhotos;
  hideRow.classList.toggle("is-disabled", !onPhotos);
  hideToggle.disabled = !onPhotos;
  selectOccupying.disabled = !onPhotos || running;
  deleteOccupying.disabled = !onPhotos || running;
  deleteAll.disabled = !onPhotos || running;
  stop.hidden = !onPhotos || !running;
  stop.disabled = !onPhotos || !running;
}

function renderStats(onPhotos, response) {
  if (!onPhotos) {
    stats.hidden = true;
    return;
  }
  if (!response) {
    stats.hidden = true;
    return;
  }

  const scanned = String(response.scanned ?? 0);
  const listed = String(response.listed ?? scanned);
  const occupying = String(response.occupying ?? 0);
  const selected = String(response.selected ?? 0);
  const deleted = String(response.deleted ?? 0);
  const job = response.job || "";

  stats.hidden = false;
  if (job === "hide") {
    stats.textContent = msg("statsScanning", [scanned, listed, occupying]);
  } else if (job === "select") {
    stats.textContent = msg("statsSelecting", [scanned, listed, selected, occupying]);
  } else if (job === "deleteOccupying" || job === "deleteAll") {
    stats.textContent = msg("statsDeleting", [scanned, listed, deleted]);
  } else if (response.cancelled) {
    stats.textContent = msg("statsStopped", [scanned, occupying, deleted]);
  } else if (response.scanDone) {
    stats.textContent = msg("statsDone", [scanned, occupying, deleted]);
  } else {
    stats.textContent = msg("statsIdle");
  }
}

async function refreshStatus() {
  const tab = await getActiveTab();
  const onPhotos = Boolean(tab && isPhotosUrl(tab.url));
  const response = onPhotos ? await sendToTab(tab.id, { type: "GPSF_GET_STATUS" }) : null;
  const running = Boolean(response?.job);

  setActionsEnabled(onPhotos, running);
  if (response && typeof response.hideHighlights === "boolean") {
    hideHighlightsToggle.checked = response.hideHighlights;
  }
  if (response && typeof response.hideNonConsuming === "boolean") {
    hideToggle.checked = response.hideNonConsuming;
  }

  hint.hidden = false;
  if (!onPhotos) {
    hint.classList.add("warn");
    hint.textContent = msg("hintNeedPhotos");
  } else if (response?.lastError) {
    hint.classList.add("warn");
    hint.textContent = response.lastError;
  } else if (running) {
    hint.classList.remove("warn");
    hint.textContent = msg("hintRunning");
  } else {
    hint.classList.remove("warn");
    hint.textContent = msg("hintReady");
  }

  renderStats(onPhotos, response);
}

openPhotos.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab && isPhotosUrl(tab.url)) {
    window.close();
    return;
  }
  await chrome.tabs.create({ url: `${PHOTOS_ORIGIN}/` });
  window.close();
});

hideHighlightsToggle.addEventListener("change", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) {
    hideHighlightsToggle.checked = false;
    return;
  }
  await sendToTab(tab.id, {
    type: "GPSF_SET_HIDE_HIGHLIGHTS",
    enabled: hideHighlightsToggle.checked,
  });
  await refreshStatus();
});

hideToggle.addEventListener("change", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) {
    hideToggle.checked = false;
    return;
  }
  await sendToTab(tab.id, {
    type: "GPSF_SET_HIDE",
    enabled: hideToggle.checked,
  });
  await refreshStatus();
});

selectOccupying.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) return;
  await sendToTab(tab.id, { type: "GPSF_SELECT_OCCUPYING" });
  await refreshStatus();
});

deleteOccupying.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) return;
  if (!window.confirm(msg("confirmDeleteOccupying"))) return;
  await sendToTab(tab.id, { type: "GPSF_DELETE_OCCUPYING" });
  await refreshStatus();
});

deleteAll.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) return;
  if (!window.confirm(msg("confirmDeleteAll"))) return;
  await sendToTab(tab.id, { type: "GPSF_DELETE_ALL" });
  await refreshStatus();
});

stop.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !isPhotosUrl(tab.url)) return;
  await sendToTab(tab.id, { type: "GPSF_STOP" });
  await refreshStatus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.runStats || changes.hideNonConsuming || changes.hideHighlights)) {
    refreshStatus();
  }
});

window.setInterval(refreshStatus, 400);
chrome.storage.local.get(["hideNonConsuming", "hideHighlights"]).then((stored) => {
  if (typeof stored.hideNonConsuming === "boolean") {
    hideToggle.checked = stored.hideNonConsuming;
  }
  if (typeof stored.hideHighlights === "boolean") {
    hideHighlightsToggle.checked = stored.hideHighlights;
  }
});
refreshStatus();
