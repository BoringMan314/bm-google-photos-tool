const CHANNEL = "gpsf";
const HIDDEN_CLASS = "gpsf-hidden";
const BATCH_SIZE = 40;
const SCAN_DELAY_MS = 200;

const HIGHLIGHT_CLASS = "gpsf-highlights";
const HIGHLIGHT_TEXT_RE =
  /(精彩集錦|精彩集锦|精選影片|精选影片|ハイライト|(^|[^A-Za-z])Highlights?([^A-Za-z]|$))/i;
const HIGHLIGHT_HREF_RE = /\/(memory|memories|highlight|highlights|creations?)(\/|$|\?)/i;

const state = {
  job: null,
  lastJob: null,
  hideHighlights: false,
  hideNonConsuming: false,
  cache: new Map(),
  inflight: new Set(),
  queued: new Set(),
  queue: [],
  lookingUp: false,
  lastError: "",
  observer: null,
  scanTimer: 0,
  scanToken: 0,
  scrolling: false,
  scanDone: false,
  cancelled: false,
  listing: false,
  listComplete: false,
  listedCount: 0,
  deletedCount: 0,
  selectedCount: 0,
  scrollLock: false,
};

let requestId = 0;
const pending = new Map();

function extAlive() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function msg(key, substitutions) {
  return gpsfMsg(key, substitutions);
}

function setLocal(values) {
  if (!extAlive()) return;
  try {
    chrome.storage.local.set(values);
  } catch {}
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isCurrentJob(token) {
  return state.scanToken === token && Boolean(state.job);
}

function postToPage(message, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const id = `gpsf-${++requestId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(msg("errorTimeout")));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    window.postMessage({ channel: CHANNEL, from: "content", id, ...message }, "*");
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.from !== "bridge") return;
  const waiter = pending.get(data.id);
  if (!waiter) return;
  pending.delete(data.id);
  if (data.error) waiter.reject(new Error(data.error));
  else waiter.resolve(data.payload);
});

function detectContext() {
  const path = (location.pathname || "/").replace(/^\/u\/\d+/, "") || "/";
  const params = new URLSearchParams(location.search);

  const album = path.match(/^\/album\/([^/]+)/);
  if (album) {
    return {
      source: "album",
      albumKey: decodeURIComponent(album[1]),
      authKey: params.get("key"),
    };
  }

  const share = path.match(/^\/share\/([^/]+)/);
  if (share) {
    return {
      source: "album",
      albumKey: decodeURIComponent(share[1]),
      authKey: params.get("key"),
    };
  }

  const search = path.match(/^\/search\/(.+)$/);
  if (search) {
    return { source: "search", query: decodeURIComponent(search[1]) };
  }

  if (/trash|bin/i.test(path)) return { source: "trash" };
  if (/locked/i.test(path)) return { source: "locked" };
  if (/archive/i.test(path)) return { source: "archive" };
  if (/favorite/i.test(path)) return { source: "favorites" };
  return { source: "library" };
}

function extractMediaKey(href) {
  if (!href) return "";
  const match = href.match(/\/photo\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isGridTile(anchor) {
  if (anchor.closest("[role='dialog'], [aria-modal='true']")) return false;
  const rect = anchor.getBoundingClientRect();
  if (rect.width < 48 || rect.height < 48) return false;
  if (rect.width > 720 || rect.height > 720) return false;
  return true;
}

function collectTiles() {
  const tiles = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/photo/"]').forEach((anchor) => {
    const mediaKey = extractMediaKey(anchor.getAttribute("href"));
    if (!mediaKey || seen.has(mediaKey) || !isGridTile(anchor)) return;
    seen.add(mediaKey);
    tiles.push({ el: anchor, mediaKey });
  });
  return tiles;
}

function tileRoot(anchor) {
  const aRect = anchor.getBoundingClientRect();
  let node = anchor.parentElement;
  let best = anchor;
  for (let i = 0; i < 4 && node && node !== document.body; i += 1) {
    const rect = node.getBoundingClientRect();
    const similarSize =
      Math.abs(rect.width - aRect.width) < 48 &&
      Math.abs(rect.height - aRect.height) < 48;
    if (similarSize) best = node;
    node = node.parentElement;
  }
  return best;
}

function hideElement(el, hide) {
  if (!el) return;
  if (hide) el.classList.add(HIDDEN_CLASS);
  else el.classList.remove(HIDDEN_CLASS);
}

function isOccupying(info) {
  return info?.takesUpSpace === true && !info?.deleted;
}

function isHighlightHref(href) {
  return HIGHLIGHT_HREF_RE.test(href || "");
}

function applyTileVisibility(tile) {
  const info = state.cache.get(tile.mediaKey);
  const occupying = isOccupying(info);
  const root = tileRoot(tile.el);
  const inHighlightRow =
    state.hideHighlights &&
    Boolean(tile.el.closest(`.${HIGHLIGHT_CLASS}`) || root.closest(`.${HIGHLIGHT_CLASS}`));
  const shouldHide = inHighlightRow
    ? true
    : occupying
      ? false
      : Boolean(state.hideNonConsuming || info?.deleted === true);
  hideElement(tile.el, shouldHide);
  hideElement(root, shouldHide);
  const keep = occupying && !inHighlightRow;
  tile.el.classList.toggle("gpsf-keep", keep);
  if (root !== tile.el) root.classList.toggle("gpsf-keep", keep);
}

const DATE_HEADER_RE =
  /(今天|昨天|前天|本日|今日|昨日|本週|本周|今月|今週|Today|Yesterday|This week)|(\d{4}\s*年)|(\d{1,2}\s*月)|((January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2})|(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December))/i;

function isDateHeader(el) {
  if (!el || el.closest("#gpsf-hud")) return false;
  if (el.closest("nav, [role='navigation'], header, [role='banner']")) return false;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 64) return false;
  return DATE_HEADER_RE.test(text);
}

function collectDateHeaders() {
  const root = document.querySelector("[role='main']") || document.body;
  const found = new Set();
  root.querySelectorAll("h1, h2, h3, h4, [role='heading']").forEach((el) => {
    if (isDateHeader(el)) found.add(el);
  });
  return [...found];
}

function collectHighlightLabelEls() {
  const root = document.querySelector("[role='main']") || document.body;
  const hits = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!HIGHLIGHT_TEXT_RE.test(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || el.closest("#gpsf-hud, nav, [role='navigation'], header, [role='banner']")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) hits.push(walker.currentNode.parentElement);
  return hits;
}

function highlightCardFrom(el) {
  let node = el;
  let fallback = null;
  for (let i = 0; i < 10 && node && node !== document.body; i += 1) {
    const rect = node.getBoundingClientRect();
    const cardLike =
      rect.width >= 150 &&
      rect.width <= 720 &&
      rect.height >= 110 &&
      rect.height <= 640;
    if (cardLike) return node;
    if (!fallback && rect.width >= 150 && rect.height >= 110 && rect.height <= 720) {
      fallback = node;
    }
    node = node.parentElement;
  }
  return fallback;
}

function countGridTilesOutside(container, cards) {
  return [...container.querySelectorAll('a[href*="/photo/"]')].filter((anchor) => {
    if (!isGridTile(anchor)) return false;
    return !cards.some((card) => card.contains(anchor) || anchor.contains(card));
  }).length;
}

function hideHighlightSections() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    if (!state.hideHighlights) {
      el.classList.remove(HIGHLIGHT_CLASS);
      hideElement(el, false);
    }
  });
  if (!state.hideHighlights) return;

  const cards = [];
  const seen = new Set();
  const addCard = (card) => {
    if (!card || seen.has(card) || card.closest("#gpsf-hud")) return;
    seen.add(card);
    cards.push(card);
  };

  collectHighlightLabelEls().forEach((el) => addCard(highlightCardFrom(el)));
  const main = document.querySelector("[role='main']") || document.body;
  main.querySelectorAll("a[href*='/memory/'], a[href*='/highlight']").forEach((anchor) => {
    addCard(highlightCardFrom(anchor) || tileRoot(anchor));
  });

  if (!cards.length) return;

  const hideSet = new Set();
  const remaining = [...cards];
  while (remaining.length) {
    const first = remaining[0];
    let wrap = first.parentElement;
    let chosen = first;
    while (wrap && wrap !== document.body && !wrap.matches("[role='main']")) {
      const inside = remaining.filter((card) => wrap.contains(card));
      if (inside.length && countGridTilesOutside(wrap, inside) <= 2) {
        chosen = wrap;
        wrap = wrap.parentElement;
        continue;
      }
      break;
    }
    hideSet.add(chosen);
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (chosen === remaining[i] || chosen.contains(remaining[i])) remaining.splice(i, 1);
    }
  }

  hideSet.forEach((el) => {
    el.classList.add(HIGHLIGHT_CLASS);
    hideElement(el, true);
  });
}

function hideEmptyDateSections() {
  const oldHeaders = document.querySelectorAll(".gpsf-date-header");
  if (!state.hideNonConsuming) {
    oldHeaders.forEach((el) => {
      el.classList.remove("gpsf-date-header", "gpsf-keep-header");
      hideElement(el, false);
    });
    document.querySelectorAll(".gpsf-date-wrap").forEach((el) => {
      el.classList.remove("gpsf-date-wrap");
      hideElement(el, false);
    });
    return;
  }

  const headers = collectDateHeaders();
  oldHeaders.forEach((el) => {
    if (!headers.includes(el)) {
      el.classList.remove("gpsf-date-header", "gpsf-keep-header");
      hideElement(el, false);
    }
  });

  const occupyingTops = collectTiles()
    .filter((tile) => isOccupying(state.cache.get(tile.mediaKey)))
    .map((tile) => {
      const rect = tile.el.getBoundingClientRect();
      return rect.top + window.scrollY;
    });

  const ranked = headers
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { el, top: rect.top + window.scrollY };
    })
    .sort((a, b) => a.top - b.top);

  ranked.forEach((header, i) => {
    const nextTop = ranked[i + 1] ? ranked[i + 1].top : Number.POSITIVE_INFINITY;
    const hasKeep = occupyingTops.some((top) => top >= header.top - 8 && top < nextTop);
    header.el.classList.add("gpsf-date-header");
    header.el.classList.toggle("gpsf-keep-header", hasKeep);
    hideElement(header.el, !hasKeep);

    let wrap = header.el.parentElement;
    for (let depth = 0; depth < 4 && wrap && wrap !== document.body; depth += 1) {
      const photos = [...wrap.querySelectorAll('a[href*="/photo/"]')].filter(isGridTile);
      if (photos.length < 1) {
        wrap = wrap.parentElement;
        continue;
      }
      if (wrap.matches("[role='main'], c-wiz") || wrap.querySelector("[role='main']")) break;
      const anyKeep = photos.some((anchor) => {
        const mediaKey = extractMediaKey(anchor.getAttribute("href"));
        return isOccupying(state.cache.get(mediaKey));
      });
      wrap.classList.toggle("gpsf-date-wrap", !anyKeep);
      hideElement(wrap, !anyKeep);
      break;
    }
  });
}

function refreshVisibility() {
  hideHighlightSections();
  collectTiles().forEach(applyTileVisibility);
  hideEmptyDateSections();
}

function isLookedUp(info) {
  return Boolean(info) && Object.prototype.hasOwnProperty.call(info, "takesUpSpace");
}

function getLookedUpCount() {
  let lookedUp = 0;
  state.cache.forEach((info) => {
    if (isLookedUp(info)) lookedUp += 1;
  });
  return lookedUp;
}

function getListedCount() {
  return Math.max(state.listedCount, state.cache.size);
}

function getScannedCount() {
  return getLookedUpCount();
}

function getOccupyingCount() {
  let count = 0;
  state.cache.forEach((info) => {
    if (info?.takesUpSpace === true && !info.deleted) count += 1;
  });
  return count;
}

function getStats() {
  return {
    job: state.job,
    lastJob: state.lastJob,
    running: Boolean(state.job),
    hideNonConsuming: state.hideNonConsuming,
    hideHighlights: state.hideHighlights,
    scanned: getScannedCount(),
    listed: getListedCount(),
    occupying: getOccupyingCount(),
    selected: state.selectedCount,
    deleted: state.deletedCount,
    scanDone: state.scanDone,
    lastError: state.lastError,
    cancelled: state.cancelled,
  };
}

let statsWriteTimer = 0;
function persistStats() {
  window.clearTimeout(statsWriteTimer);
  statsWriteTimer = window.setTimeout(() => {
    setLocal({
      runStats: getStats(),
      running: Boolean(state.job),
      hideNonConsuming: state.hideNonConsuming,
      hideHighlights: state.hideHighlights,
    });
  }, 120);
}

function updateHud() {
  let hud = document.getElementById("gpsf-hud");
  if (!state.job && !state.scanDone) {
    if (hud) hud.remove();
    persistStats();
    return;
  }

  if (!hud) {
    hud = document.createElement("div");
    hud.id = "gpsf-hud";
    const text = document.createElement("span");
    text.className = "gpsf-hud-text";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "gpsf-hud-stop";
    stop.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stopJob();
    });
    hud.append(text, stop);
    document.documentElement.appendChild(hud);
  }

  const scanned = String(getLookedUpCount());
  const listed = String(getListedCount());
  const occupying = String(getOccupyingCount());
  const selected = String(state.selectedCount);
  const deleted = String(state.deletedCount);
  const extra = state.lastError ? `｜${state.lastError}` : "";
  const text = hud.querySelector(".gpsf-hud-text");
  const stop = hud.querySelector(".gpsf-hud-stop");

  if (state.job === "hide") {
    text.textContent = msg("hudHide", [scanned, listed, occupying]) + extra;
  } else if (state.job === "select") {
    text.textContent = msg("hudSelect", [scanned, listed, selected, occupying]) + extra;
  } else if (state.job === "deleteOccupying" || state.job === "deleteAll") {
    text.textContent = msg("hudDelete", [scanned, listed, deleted]) + extra;
  } else if (state.cancelled) {
    text.textContent = msg("hudStopped", [scanned, occupying, deleted]) + extra;
  } else {
    text.textContent = msg("hudDone", [scanned, occupying, deleted]) + extra;
  }

  if (stop) {
    stop.hidden = !state.job;
    stop.textContent = msg("stop");
  }
  persistStats();
}

function stopJob() {
  if (!state.job) return getStats();
  state.scanToken += 1;
  state.job = null;
  state.queue = [];
  state.queued.clear();
  state.scrolling = false;
  state.listing = false;
  state.scanDone = true;
  state.cancelled = true;
  setScrollLock(false);
  setLocal({ running: false });
  refreshVisibility();
  updateHud();
  return getStats();
}

function rememberItem(item) {
  if (!item?.mediaKey) return;
  const prev = state.cache.get(item.mediaKey) || {};
  state.cache.set(item.mediaKey, {
    ...prev,
    dedupKey: item.dedupKey || prev.dedupKey || "",
  });
}

function canTrashHere() {
  return detectContext().source !== "trash";
}

async function resolveDedupKey(mediaKey) {
  const cached = state.cache.get(mediaKey);
  if (cached?.dedupKey) return cached.dedupKey;
  const info = await postToPage({ type: "ITEM_INFO", mediaKey });
  const dedupKey = info?.dedupKey || "";
  if (dedupKey) {
    state.cache.set(mediaKey, { ...state.cache.get(mediaKey), dedupKey });
  }
  return dedupKey;
}

async function lookupKeys(mediaKeys) {
  const token = state.scanToken;
  const payload = await postToPage({ type: "LOOKUP", mediaKeys });
  if (state.scanToken !== token) return mediaKeys;
  const seen = new Set();
  (payload || []).forEach((item) => {
    if (!item?.mediaKey) return;
    seen.add(item.mediaKey);
    state.cache.set(item.mediaKey, {
      ...state.cache.get(item.mediaKey),
      takesUpSpace: item.takesUpSpace,
      dedupKey: item.dedupKey || state.cache.get(item.mediaKey)?.dedupKey || "",
    });
  });
  return mediaKeys.filter((key) => !seen.has(key));
}

async function drainQueue() {
  if (state.lookingUp) return;
  state.lookingUp = true;
  const token = state.scanToken;
  try {
    while (state.queue.length && state.scanToken === token) {
      const batch = state.queue.splice(0, BATCH_SIZE);
      batch.forEach((key) => {
        state.queued.delete(key);
        state.inflight.add(key);
      });
      try {
        const missing = await lookupKeys(batch);
        if (state.scanToken !== token) break;
        missing.forEach((key) => {
          state.cache.set(key, {
            ...state.cache.get(key),
            takesUpSpace: null,
          });
        });
        state.lastError = "";
      } catch (error) {
        if (state.scanToken !== token) break;
        state.lastError = error instanceof Error ? error.message : String(error);
        batch.forEach((key) => {
          state.cache.set(key, {
            ...state.cache.get(key),
            takesUpSpace: state.cache.get(key)?.takesUpSpace ?? null,
          });
        });
      } finally {
        batch.forEach((key) => state.inflight.delete(key));
      }
      if (state.scanToken !== token) break;
      refreshVisibility();
      updateHud();
    }
  } finally {
    state.lookingUp = false;
    if (state.queue.length && state.scanToken !== token) drainQueue();
  }
}

function enqueueUnknown(mediaKeys) {
  mediaKeys.forEach((key) => {
    if (!key || state.inflight.has(key) || state.queued.has(key)) return;
    if (isLookedUp(state.cache.get(key))) return;
    if (state.listComplete && !state.cache.has(key)) return;
    state.queued.add(key);
    state.queue.push(key);
  });
  drainQueue();
}

function scan() {
  hideHighlightSections();
  const tiles = collectTiles();
  tiles.forEach(applyTileVisibility);
  hideEmptyDateSections();
  if (state.hideNonConsuming || state.job) {
    enqueueUnknown(tiles.map((tile) => tile.mediaKey));
  }
  updateHud();
}

function scheduleScan() {
  if (state.hideNonConsuming) {
    collectTiles().forEach(applyTileVisibility);
  }
  if (state.hideHighlights) hideHighlightSections();
  window.clearTimeout(state.scanTimer);
  state.scanTimer = window.setTimeout(scan, state.hideNonConsuming || state.hideHighlights ? 50 : SCAN_DELAY_MS);
}

function findScrollContainer() {
  const fallback = document.scrollingElement || document.documentElement;
  let best = fallback;
  let bestOverflow = Math.max(0, fallback.scrollHeight - fallback.clientHeight);
  document.querySelectorAll('[role="main"], c-wiz').forEach((el) => {
    if (el.clientHeight < 240) return;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll") return;
    const extra = el.scrollHeight - el.clientHeight;
    if (extra > bestOverflow) {
      best = el;
      bestOverflow = extra;
    }
  });
  return best;
}

function setScrollTop(scroller, top) {
  if (
    scroller === document.scrollingElement ||
    scroller === document.documentElement ||
    scroller === document.body
  ) {
    window.scrollTo(0, top);
    return;
  }
  scroller.scrollTop = top;
}

const SCROLL_LOCK_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

function onLockScroll(event) {
  event.preventDefault();
  event.stopPropagation();
}

function onLockScrollKey(event) {
  if (!SCROLL_LOCK_KEYS.has(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
}

function setScrollLock(locked) {
  const opts = { capture: true, passive: false };
  if (locked) {
    if (state.scrollLock) return;
    state.scrollLock = true;
    window.addEventListener("wheel", onLockScroll, opts);
    window.addEventListener("touchmove", onLockScroll, opts);
    window.addEventListener("keydown", onLockScrollKey, opts);
    return;
  }
  if (!state.scrollLock) return;
  state.scrollLock = false;
  window.removeEventListener("wheel", onLockScroll, opts);
  window.removeEventListener("touchmove", onLockScroll, opts);
  window.removeEventListener("keydown", onLockScrollKey, opts);
}

function checkboxIn(root, el) {
  return (
    root.querySelector('[role="checkbox"]') ||
    el.querySelector('[role="checkbox"]') ||
    root.querySelector('[aria-label*="Select"], [aria-label*="選取"], [aria-label*="选择"], [aria-label*="選択"]') ||
    el.querySelector('[aria-label*="Select"], [aria-label*="選取"], [aria-label*="选择"], [aria-label*="選択"]')
  );
}

function isTileSelected(tile) {
  const root = tileRoot(tile.el);
  const box = checkboxIn(root, tile.el);
  if (box?.getAttribute("aria-checked") === "true") return true;
  if (root.getAttribute("aria-selected") === "true") return true;
  if (tile.el.getAttribute("aria-selected") === "true") return true;
  return Boolean(state.cache.get(tile.mediaKey)?.selected);
}

function dispatchAt(el, type, x, y) {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    })
  );
}

async function selectTile(tile) {
  if (isTileSelected(tile)) return true;
  const root = tileRoot(tile.el);
  const rect = root.getBoundingClientRect();
  const hoverX = rect.left + Math.min(22, Math.max(8, rect.width * 0.14));
  const hoverY = rect.top + Math.min(22, Math.max(8, rect.height * 0.14));

  dispatchAt(root, "pointerover", hoverX, hoverY);
  dispatchAt(root, "mouseover", hoverX, hoverY);
  dispatchAt(root, "mouseenter", hoverX, hoverY);
  await wait(70);

  const checkbox = checkboxIn(root, tile.el);
  if (checkbox && checkbox.getAttribute("aria-checked") !== "true") {
    checkbox.click();
    await wait(50);
    return isTileSelected(tile);
  }

  const hit = document.elementFromPoint(hoverX, hoverY) || root;
  dispatchAt(hit, "pointerdown", hoverX, hoverY);
  dispatchAt(hit, "mousedown", hoverX, hoverY);
  dispatchAt(hit, "mouseup", hoverX, hoverY);
  dispatchAt(hit, "click", hoverX, hoverY);
  await wait(50);
  return isTileSelected(tile);
}

async function selectVisibleOccupying(token) {
  const tiles = collectTiles();
  for (const tile of tiles) {
    if (!isCurrentJob(token)) return;
    const info = state.cache.get(tile.mediaKey);
    if (info?.takesUpSpace !== true || info.deleted || info.selected) continue;
    if (await selectTile(tile)) {
      state.cache.set(tile.mediaKey, {
        ...state.cache.get(tile.mediaKey),
        selected: true,
      });
      state.selectedCount += 1;
      updateHud();
    }
    await wait(80);
  }
}

async function autoScrollAll(token, { select = false } = {}) {
  setScrollLock(true);
  state.scrolling = true;
  try {
    await wait(400);
    const scroller = findScrollContainer();
    setScrollTop(scroller, 0);
    scan();
    if (select) await selectVisibleOccupying(token);

    let stuck = 0;
    let lastHeight = 0;
    let lastTop = -1;
    const started = Date.now();

    while (isCurrentJob(token) && Date.now() - started < 20 * 60 * 1000) {
      scan();
      if (select) await selectVisibleOccupying(token);
      const prevHeight = scroller.scrollHeight;
      const maxTop = Math.max(0, prevHeight - scroller.clientHeight);
      const step = Math.max(Math.floor(scroller.clientHeight * 0.8), 500);
      setScrollTop(scroller, Math.min(maxTop, (scroller.scrollTop || 0) + step));

      const waitStart = Date.now();
      while (Date.now() - waitStart < 900 && isCurrentJob(token)) {
        if (scroller.scrollHeight > prevHeight + 24) break;
        await wait(100);
        updateHud();
      }

      scan();
      if (select) await selectVisibleOccupying(token);
      const top = scroller.scrollTop;
      const atBottom = top >= maxTop - 12;
      const noGrowth = scroller.scrollHeight <= lastHeight + 8;
      if ((atBottom && noGrowth) || (top === lastTop && noGrowth)) stuck += 1;
      else stuck = 0;
      lastHeight = scroller.scrollHeight;
      lastTop = top;
      if (stuck >= 8) break;
    }

    if (isCurrentJob(token)) {
      setScrollTop(scroller, 0);
      scan();
      if (select) await selectVisibleOccupying(token);
    }
  } finally {
    if (state.scanToken === token) state.scrolling = false;
    setScrollLock(false);
  }
}

async function waitUntilLookupsIdle(token) {
  while (isCurrentJob(token) && (state.lookingUp || state.queue.length || state.listing)) {
    await wait(120);
    updateHud();
  }
}

async function fullScan(token, { lookup = true, source, applyVisibility = true } = {}) {
  const ctx = source
    ? { source, albumKey: "", authKey: "", query: "" }
    : detectContext();
  state.listing = true;
  state.lastError = "";
  updateHud();

  try {
    const allKeys = [];
    const seenKeys = new Set();
    const seenPages = new Set();
    let pageId = null;
    let timestamp = null;
    let emptyStreak = 0;

    do {
      if (!isCurrentJob(token)) return;
      const page = await postToPage({
        type: "LIST_PAGE",
        source: ctx.source,
        pageId,
        timestamp,
        albumKey: ctx.albumKey,
        authKey: ctx.authKey,
        query: ctx.query,
      });
      if (!isCurrentJob(token)) return;
      const items = page?.items || [];
      const keys = items.map((item) => item.mediaKey).filter(Boolean);
      items.forEach(rememberItem);
      let added = 0;
      keys.forEach((key) => {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        allKeys.push(key);
        added += 1;
      });
      state.listedCount = allKeys.length;
      if (lookup) enqueueUnknown(keys);
      if (applyVisibility) refreshVisibility();
      updateHud();

      if (!added) emptyStreak += 1;
      else emptyStreak = 0;
      if (emptyStreak >= 3) break;

      const next = page?.nextPageId || null;
      if (next && seenPages.has(next)) break;
      if (next) seenPages.add(next);
      pageId = next;
      if (page?.lastItemTimestamp && !Number.isNaN(page.lastItemTimestamp)) {
        timestamp = page.lastItemTimestamp - 1;
      }
    } while (pageId);

    if (!isCurrentJob(token)) return;
    state.listComplete = true;
    if (lookup) enqueueUnknown(allKeys);
    if (applyVisibility) refreshVisibility();
    updateHud();
  } catch (error) {
    if (state.scanToken !== token) return;
    state.lastError = error instanceof Error ? error.message : String(error);
    updateHud();
  } finally {
    if (state.scanToken === token) state.listing = false;
  }
}

async function trashKeys(mediaKeys, token) {
  if (!canTrashHere()) {
    state.lastError = msg("errorInTrash");
    updateHud();
    return;
  }

  const targets = [];
  for (const mediaKey of mediaKeys) {
    if (!isCurrentJob(token)) return;
    const info = state.cache.get(mediaKey);
    if (info?.deleted) continue;
    try {
      const dedupKey = await resolveDedupKey(mediaKey);
      if (dedupKey) targets.push({ mediaKey, dedupKey });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const size = 40;
  for (let i = 0; i < targets.length; i += size) {
    if (!isCurrentJob(token)) return;
    const chunk = targets.slice(i, i + size);
    await postToPage({
      type: "TRASH",
      dedupKeys: chunk.map((item) => item.dedupKey),
    });
    chunk.forEach((item) => {
      state.cache.set(item.mediaKey, {
        ...state.cache.get(item.mediaKey),
        deleted: true,
      });
      state.deletedCount += 1;
    });
    refreshVisibility();
    updateHud();
  }
}

function cacheKeys(predicate) {
  const keys = [];
  state.cache.forEach((info, key) => {
    if (predicate(info, key)) keys.push(key);
  });
  return keys;
}

function resetScanState() {
  state.cache.clear();
  state.queue = [];
  state.queued.clear();
  state.inflight.clear();
  state.listComplete = false;
  state.listedCount = 0;
  state.deletedCount = 0;
  state.selectedCount = 0;
  state.listing = false;
  state.scrolling = false;
  state.lastError = "";
  document.querySelectorAll(".gpsf-keep, .gpsf-keep-header").forEach((el) => {
    el.classList.remove("gpsf-keep", "gpsf-keep-header");
  });
  if (!state.hideNonConsuming) {
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
      if (el.classList.contains(HIGHLIGHT_CLASS)) return;
      el.classList.remove(HIDDEN_CLASS);
    });
    document.querySelectorAll(".gpsf-date-header, .gpsf-date-wrap").forEach((el) => {
      el.classList.remove("gpsf-date-header", "gpsf-date-wrap", "gpsf-keep-header");
    });
  }
}

async function runJob(type, runner) {
  state.scanToken += 1;
  const token = state.scanToken;
  resetScanState();
  state.job = type;
  state.lastJob = type;
  state.lastError = "";
  state.scanDone = false;
  state.cancelled = false;
  setLocal({ running: true });
  updateHud();
  try {
    await runner(token);
  } catch (error) {
    if (state.scanToken === token) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (state.scanToken === token) {
      state.job = null;
      state.scanDone = true;
      setLocal({ running: false });
      refreshVisibility();
      updateHud();
    }
  }
}

function setHideNonConsuming(enabled) {
  enabled = Boolean(enabled);
  state.hideNonConsuming = enabled;
  document.documentElement.classList.toggle("gpsf-filter-on", enabled);
  setLocal({ hideNonConsuming: enabled });

  if (!enabled) {
    refreshVisibility();
    if (state.job === "hide") stopJob();
    return getStats();
  }

  refreshVisibility();
  if (state.job && state.job !== "hide") stopJob();
  runJob("hide", async (token) => {
    await fullScan(token);
    await waitUntilLookupsIdle(token);
    refreshVisibility();
  });
  return getStats();
}

function setHideHighlights(enabled) {
  enabled = Boolean(enabled);
  state.hideHighlights = enabled;
  document.documentElement.classList.toggle("gpsf-hide-highlights", enabled);
  setLocal({ hideHighlights: enabled });
  refreshVisibility();
  return getStats();
}

function startSelectOccupying() {
  runJob("select", async (token) => {
    await fullScan(token);
    await waitUntilLookupsIdle(token);
    if (!isCurrentJob(token)) return;
    await autoScrollAll(token, { select: true });
  });
  return getStats();
}

function startDeleteOccupying() {
  runJob("deleteOccupying", async (token) => {
    if (!canTrashHere()) throw new Error(msg("errorInTrash"));
    await fullScan(token);
    await waitUntilLookupsIdle(token);
    if (!isCurrentJob(token)) return;
    await trashKeys(
      cacheKeys((info) => info?.takesUpSpace === true && !info.deleted),
      token
    );
  });
  return getStats();
}

function startDeleteAll() {
  runJob("deleteAll", async (token) => {
    if (!canTrashHere()) throw new Error(msg("errorInTrash"));
    await fullScan(token, { lookup: false });
    if (!isCurrentJob(token)) return;
    await trashKeys(
      cacheKeys((info) => !info?.deleted),
      token
    );
  });
  return getStats();
}

function resetForNewPage() {
  state.scanToken += 1;
  state.job = null;
  state.lastJob = null;
  state.cache.clear();
  state.queue = [];
  state.queued.clear();
  state.inflight.clear();
  state.scrolling = false;
  state.listing = false;
  state.listComplete = false;
  state.listedCount = 0;
  state.deletedCount = 0;
  state.selectedCount = 0;
  state.scanDone = false;
  state.cancelled = false;
  state.lastError = "";
  setLocal({ running: false });
  updateHud();
  if (state.hideNonConsuming) setHideNonConsuming(true);
  else if (state.hideHighlights) hideHighlightSections();
}

function startUrlWatch() {
  let lastPath = location.pathname + location.search;
  window.setInterval(() => {
    const now = location.pathname + location.search;
    if (now === lastPath) return;
    lastPath = now;
    resetForNewPage();
  }, 800);
}

function startObserver() {
  if (state.observer) return;
  state.observer = new MutationObserver(() => scheduleScan());
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("scroll", scheduleScan, { passive: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GPSF_SET_HIDE") {
    sendResponse(setHideNonConsuming(message.enabled));
    return true;
  }
  if (message?.type === "GPSF_SET_HIDE_HIGHLIGHTS") {
    sendResponse(setHideHighlights(message.enabled));
    return true;
  }
  if (message?.type === "GPSF_SELECT_OCCUPYING") {
    sendResponse(startSelectOccupying());
    return true;
  }
  if (message?.type === "GPSF_DELETE_OCCUPYING") {
    sendResponse(startDeleteOccupying());
    return true;
  }
  if (message?.type === "GPSF_DELETE_ALL") {
    sendResponse(startDeleteAll());
    return true;
  }
  if (message?.type === "GPSF_STOP") {
    sendResponse(stopJob());
    return true;
  }
  if (message?.type === "GPSF_GET_STATUS") {
    sendResponse(getStats());
    return true;
  }
  return false;
});

async function init() {
  try {
    if (!extAlive()) return;
    startObserver();
    startUrlWatch();
    const stored = await chrome.storage.local.get(["hideNonConsuming", "hideHighlights"]);
    if (stored.hideHighlights) setHideHighlights(true);
    if (stored.hideNonConsuming) setHideNonConsuming(true);
    else scan();
  } catch (error) {
    console.warn("[GPSF] init", error);
  }
}

init();
