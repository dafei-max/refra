const PINTEREST_RESOURCE_URL = "https://www.pinterest.com/resource/BaseSearchResource/get/";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0 Safari/537.36";

export class PinterestSearchError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "PinterestSearchError";
    this.statusCode = statusCode;
  }
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function imageVariant(images, names) {
  for (const name of names) {
    const candidate = images?.[name];
    if (candidate?.url) return candidate;
  }
  return null;
}

function normalizePin(pin, query, queryIndex) {
  if (!pin || pin.type !== "pin" || !pin.id || !pin.images) return null;
  const display = imageVariant(pin.images, ["736x", "orig", "564x", "474x", "236x"]);
  const thumbnail = imageVariant(pin.images, ["474x", "564x", "236x", "736x", "orig"]);
  const original = imageVariant(pin.images, ["orig", "736x", "564x", "474x"]);
  if (!display?.url || !thumbnail?.url) return null;

  const annotations = Array.isArray(pin.pin_join?.visual_annotation)
    ? pin.pin_join.visual_annotation.map(text).filter(Boolean)
    : [];
  return {
    id: text(pin.id),
    title: text(pin.grid_title || pin.title) || "Pinterest 设计案例",
    description: text(pin.description || pin.auto_alt_text),
    imageUrl: display.url,
    thumbnailUrl: thumbnail.url,
    pinUrl: `https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/`,
    source: "pinterest",
    width: Number(original?.width || display.width || 0),
    height: Number(original?.height || display.height || 0),
    query,
    designType: "视觉设计",
    __queryIndex: queryIndex,
    __annotations: annotations,
    __imageSignature: text(pin.image_signature),
    __isVideo: Boolean(
      pin.is_video ||
      pin.content_type === "video" ||
      (pin.videos?.video_list && Object.keys(pin.videos.video_list).length),
    ),
    __isProduct: Boolean(pin.is_eligible_for_pdp || pin.shopping_flags?.length || pin.product_pin_data),
    __isPromoted: Boolean(pin.is_promoted || pin.promoted_is_removable),
  };
}

function buildResourceUrl(query) {
  const url = new URL(PINTEREST_RESOURCE_URL);
  url.searchParams.set("source_url", `/search/pins/?q=${encodeURIComponent(query)}`);
  url.searchParams.set("data", JSON.stringify({
    options: {
      query,
      scope: "pins",
      no_fetch_context_on_resource: false,
    },
    context: {},
  }));
  return url;
}

export async function searchPinterestQuery(query, { queryIndex = 0, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildResourceUrl(query), {
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "User-Agent": DEFAULT_USER_AGENT,
        "X-Pinterest-PWS-Handler": "www/search/[scope].js",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PinterestSearchError(`Pinterest 搜索返回 HTTP ${response.status}`);
    }
    const payload = await response.json();
    const results = payload?.resource_response?.data?.results;
    if (!Array.isArray(results)) {
      throw new PinterestSearchError("Pinterest 搜索响应结构已变化");
    }
    return results.map((pin) => normalizePin(pin, query, queryIndex)).filter(Boolean);
  } catch (error) {
    if (error instanceof PinterestSearchError) throw error;
    if (error?.name === "AbortError") throw new PinterestSearchError("Pinterest 搜索超时", 504);
    throw new PinterestSearchError(`Pinterest 搜索失败：${error?.message || "未知错误"}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPinterestQueries(queries, { concurrency = 3 } = {}) {
  const items = [];
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queries.length) {
      const queryIndex = cursor;
      const query = queries[cursor];
      cursor += 1;
      try {
        items.push(...await searchPinterestQuery(query, { queryIndex }));
      } catch (error) {
        failures.push({ query, error: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  if (!items.length && failures.length) {
    throw new PinterestSearchError(failures[0].error || "Pinterest 搜索暂时不可用");
  }
  return { items, failures };
}
