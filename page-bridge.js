(function gpsfPageBridge() {
  const CHANNEL = "gpsf";

  function getWiz() {
    const data = window.WIZ_global_data;
    if (!data) return null;
    return {
      at: data.SNlM0e || "",
      sid: data.FdrFJe != null ? String(data.FdrFJe) : "",
      bl: data.cfb2h || "",
      path: data.eptZe || "/_/PhotosUi/",
      rapt: typeof data.Dbw5Ud === "string" ? data.Dbw5Ud : null,
    };
  }

  function lastItem(arr) {
    return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined;
  }

  function parseTakesUpSpace(flag, spaceTaken) {
    if (flag === 1) return true;
    if (flag === undefined || flag === null) {
      if (typeof spaceTaken === "number" && spaceTaken > 0) return true;
      return null;
    }
    return false;
  }

  function parseBulkItem(itemData) {
    const info = itemData?.[1] || [];
    const spaceMeta = Array.isArray(lastItem(info)) ? lastItem(info) : [];
    return {
      mediaKey: itemData?.[0] || "",
      takesUpSpace: parseTakesUpSpace(spaceMeta[0], spaceMeta[1]),
    };
  }

  function parseItemInfo(data) {
    const knownKeys = ["318563170", "76647426", "163238866"];
    const row = data?.[0] || [];
    const extObj = row.find(
      (x) =>
        x &&
        typeof x === "object" &&
        !Array.isArray(x) &&
        Object.keys(x).some((k) => knownKeys.includes(k))
    );
    const spaceMeta = extObj?.[318563170]?.[0] || [];
    return {
      mediaKey: row[0] || "",
      dedupKey: row[3] || "",
      takesUpSpace: parseTakesUpSpace(spaceMeta[0], spaceMeta[1]),
    };
  }

  function normalizePath(path) {
    let value = path || "/_/PhotosUi/";
    if (!value.startsWith("/")) value = `/${value}`;
    if (!value.endsWith("/")) value += "/";
    return value;
  }

  function parseBatchExecute(body) {
    const cleaned = String(body || "").replace(/^\)\]\}'\s*/, "");
    const lines = cleaned.split("\n").filter((line) => line.includes("wrb.fr"));
    if (!lines.length) {
      throw new Error("batchexecute 回應格式不符");
    }

    let parsed;
    try {
      parsed = JSON.parse(lines[0]);
    } catch {
      const start = lines[0].indexOf("[");
      parsed = JSON.parse(start >= 0 ? lines[0].slice(start) : lines[0]);
    }

    const first = parsed?.[0];
    const payload = Array.isArray(first) && first[0] === "wrb.fr" ? first[2] : parsed?.[2];
    if (payload == null || payload === "") return null;
    return typeof payload === "string" ? JSON.parse(payload) : payload;
  }

  const apiJobs = [];
  let apiActive = 0;

  function enqueueApi(task) {
    return new Promise((resolve, reject) => {
      apiJobs.push({ task, resolve, reject });
      pumpApi();
    });
  }

  async function pumpApi() {
    if (apiActive >= 2 || !apiJobs.length) return;
    const job = apiJobs.shift();
    apiActive += 1;
    try {
      job.resolve(await job.task());
    } catch (error) {
      job.reject(error);
    } finally {
      apiActive -= 1;
      pumpApi();
    }
  }

  async function makeApiRequest(rpcid, requestData) {
    return enqueueApi(async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const wiz = getWiz();
          if (!wiz?.at) {
            throw new Error("找不到登入權杖，請重新整理頁面");
          }

          const wrapped = [[[rpcid, JSON.stringify(requestData), null, "generic"]]];
          const body = `f.req=${encodeURIComponent(JSON.stringify(wrapped))}&at=${encodeURIComponent(wiz.at)}&`;
          const params = new URLSearchParams({
            rpcids: rpcid,
            "source-path": location.pathname,
            "f.sid": wiz.sid,
            bl: wiz.bl,
            pageId: "none",
            rt: "c",
          });
          if (wiz.rapt) params.set("rapt", wiz.rapt);

          const url = `${location.origin}${normalizePath(wiz.path)}data/batchexecute?${params.toString()}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          let response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
              },
              body,
              credentials: "include",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          if (!text) throw new Error("空回應");
          return parseBatchExecute(text);
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }
      throw lastError || new Error("API 請求失敗");
    });
  }

  async function getBatchMediaInfo(mediaKeys) {
    if (!mediaKeys.length) return [];
    const rpcid = "EWgK9e";
    const mappedKeys = mediaKeys.map((id) => [id]);
    const requestData = [
      [
        [mappedKeys],
        [
          [
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, [], null, null, null, null, null,
            null, null, null, null, null, [],
          ],
        ],
      ],
    ];
    const payload = await makeApiRequest(rpcid, requestData);
    const rows = payload?.[0]?.[1] || [];
    return rows.map(parseBulkItem).filter((item) => item.mediaKey);
  }

  async function getItemInfo(mediaKey) {
    const payload = await makeApiRequest("VrseUb", [mediaKey, null, null, null, null]);
    return parseItemInfo(payload);
  }

  function mapKeys(rows) {
    return (rows || [])
      .map((item) => ({
        mediaKey: item?.[0] || "",
        dedupKey: item?.[3] || "",
      }))
      .filter((item) => item.mediaKey);
  }

  function asPageId(value) {
    if (typeof value === "string" && value.length > 0) return value;
    return null;
  }

  async function listPage(req) {
    const pageId = req.pageId || null;
    const source = req.source || "library";

    if (source === "album") {
      const response = await makeApiRequest("snAcKc", [
        req.albumKey,
        pageId,
        null,
        req.authKey || null,
      ]);
      return {
        items: mapKeys(response?.[1] || []),
        nextPageId: asPageId(response?.[2]),
        lastItemTimestamp: null,
      };
    }

    if (source === "search") {
      const response = await makeApiRequest("EzkLib", [req.query || "", null, pageId]);
      return {
        items: mapKeys(response?.[0] || []),
        nextPageId: asPageId(response?.[1]),
        lastItemTimestamp: null,
      };
    }

    if (source === "favorites") {
      const response = await makeApiRequest("EzkLib", ["Favorites", [[5, "8", 0, 9]], pageId]);
      return {
        items: mapKeys(response?.[0] || []),
        nextPageId: asPageId(response?.[1]),
        lastItemTimestamp: null,
      };
    }

    if (source === "trash") {
      const response = await makeApiRequest("zy0IHe", [pageId]);
      return {
        items: mapKeys(response?.[0] || []),
        nextPageId: asPageId(response?.[1]),
        lastItemTimestamp: null,
      };
    }

    const sourceCode = source === "archive" ? 2 : 1;
    const timestamp = req.timestamp ?? null;
    const response = await makeApiRequest("lcxiM", [pageId, timestamp, 100, null, 1, sourceCode]);
    return {
      items: mapKeys(response?.[0] || []),
      nextPageId: asPageId(response?.[1]),
      lastItemTimestamp: response?.[2] != null ? parseInt(response[2], 10) : null,
    };
  }

  async function lookup(mediaKeys) {
    if (!mediaKeys.length) return [];
    const keys = mediaKeys.slice(0, 40);
    try {
      const bulk = await getBatchMediaInfo(keys);
      if (bulk.length) return bulk;
    } catch {}

    const results = [];
    for (const mediaKey of keys.slice(0, 10)) {
      try {
        results.push(await getItemInfo(mediaKey));
      } catch {
        results.push({ mediaKey, takesUpSpace: null, dedupKey: "" });
      }
    }
    return results;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.from === "bridge") return;

    const reply = (type, extra) => {
      window.postMessage(
        { channel: CHANNEL, from: "bridge", type, id: data.id, ...extra },
        "*"
      );
    };

    if (data.type === "LIST_PAGE") {
      listPage(data)
        .then((payload) => reply("LIST_PAGE_RESULT", { payload }))
        .catch((error) =>
          reply("LIST_PAGE_RESULT", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return;
    }

    if (data.type === "LOOKUP") {
      lookup(data.mediaKeys || [])
        .then((payload) => reply("LOOKUP_RESULT", { payload }))
        .catch((error) =>
          reply("LOOKUP_RESULT", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return;
    }

    if (data.type === "ITEM_INFO") {
      getItemInfo(data.mediaKey)
        .then((payload) => reply("ITEM_INFO_RESULT", { payload }))
        .catch((error) =>
          reply("ITEM_INFO_RESULT", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return;
    }

    if (data.type === "TRASH") {
      makeApiRequest("XwAOJf", [null, 1, data.dedupKeys || [], 3])
        .then((payload) => reply("TRASH_RESULT", { payload }))
        .catch((error) =>
          reply("TRASH_RESULT", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }
  });
})();
