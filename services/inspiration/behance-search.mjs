const BEHANCE_SEARCH_URL = "https://www.behance.net/search/projects/";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0 Safari/537.36";

export class BehanceSearchError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "BehanceSearchError";
    this.statusCode = statusCode;
  }
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function cleanText(value) {
  return decodeHtml(String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "");
}

function canonicalProjectUrl(rawUrl) {
  try {
    const url = new URL(decodeHtml(rawUrl), "https://www.behance.net");
    const host = url.hostname.toLowerCase();
    if (host !== "behance.net" && host !== "www.behance.net") return "";
    if (!/^\/gallery\/\d+\//.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.behance.net";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function imageDimensions(imageUrl) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const token = pathname.match(/\.([A-Za-z0-9_-]+)\.(?:avif|gif|jpe?g|png|webp)$/i)?.[1];
    if (!token) return { width: 808, height: 632 };
    const padded = token.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(token.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const crop = decoded.match(/^crop,(\d+),(\d+),/i);
    if (!crop) return { width: 808, height: 632 };
    const sourceWidth = Number(crop[1]);
    const sourceHeight = Number(crop[2]);
    if (!sourceWidth || !sourceHeight) return { width: 808, height: 632 };
    return { width: 808, height: Math.max(1, Math.round(808 * sourceHeight / sourceWidth)) };
  } catch {
    return { width: 808, height: 632 };
  }
}

function pictureUrls(chunk) {
  const picture = chunk.match(/<picture\b[^>]*ProjectCoverNeue-picture[^>]*>([\s\S]*?)<\/picture>/i)?.[1] || "";
  const urls = [];
  for (const source of picture.matchAll(/<source\b[^>]*srcset="([^"]+)"[^>]*>/gi)) {
    for (const candidate of decodeHtml(source[1]).split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  for (const imageTag of picture.matchAll(/<img\b[^>]*>/gi)) {
    const url = attribute(imageTag[0], "src");
    if (url) urls.push(url);
  }
  const allowed = [...new Set(urls)].filter((rawUrl) => {
    try {
      return new URL(rawUrl).hostname.toLowerCase().endsWith("behance.net");
    } catch {
      return false;
    }
  });
  const display = allowed.find((url) => /\/projects\/max_808_webp\//.test(url))
    || allowed.find((url) => /\/projects\/808_webp\//.test(url))
    || allowed.find((url) => /\/projects\/max_808\//.test(url))
    || allowed.find((url) => /\/projects\/808\//.test(url))
    || allowed[0]
    || "";
  const thumbnail = allowed.find((url) => /\/projects\/404_webp\//.test(url))
    || allowed.find((url) => /\/projects\/404\//.test(url))
    || display;
  return { display, thumbnail };
}

function normalizeProject(marker, chunk, query, queryIndex) {
  const anchorTags = [...chunk.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
  const projectTag = anchorTags.find((tag) => attribute(tag, "class").includes("ProjectCoverNeue-coverLink"))
    || anchorTags.find((tag) => attribute(tag, "aria-label") === "title");
  const projectUrl = canonicalProjectUrl(attribute(projectTag, "href"));
  const projectId = projectUrl.match(/\/gallery\/(\d+)\//)?.[1] || "";
  const { display, thumbnail } = pictureUrls(chunk);
  if (!projectId || !projectUrl || !display || !thumbnail) return null;

  const ownerTag = anchorTags.find((tag) => attribute(tag, "class").split(/\s+/).some((name) => name.startsWith("Owners-owner-")));
  const ownerMatch = ownerTag
    ? chunk.slice(chunk.indexOf(ownerTag) + ownerTag.length).match(/^([\s\S]*?)<\/a>/i)
    : null;
  const author = cleanText(ownerMatch?.[1])
    || cleanText(chunk.match(/Owners-multipleOwnersText[^>]*>[\s\S]*?<!--\[-->([^<]+)/i)?.[1]);
  const title = decodeHtml(marker[1]).replace(/\s+/g, " ").trim() || "Behance 设计项目";
  const { width, height } = imageDimensions(display);

  return {
    id: `behance_${projectId}`,
    sourceId: projectId,
    title,
    description: author ? `Behance 公开设计项目，作者：${author}` : "Behance 公开设计项目",
    author,
    imageUrl: display,
    thumbnailUrl: thumbnail,
    sourceUrl: projectUrl,
    source: "behance",
    width,
    height,
    query,
    designType: "视觉设计",
    __queryIndex: queryIndex,
    __annotations: [],
    __imageSignature: display.replace(/\/projects\/(?:max_)?(?:115|202|230|404|808)(?:_webp)?\//, "/projects/"),
    __isVideo: false,
    __isProduct: false,
    __isPromoted: false,
  };
}

export function parseBehanceSearchHtml(html, query, queryIndex = 0) {
  const source = String(html || "");
  const markers = [...source.matchAll(/<div aria-label="([^"]*)" class="[^"]*\bqa-search-project-item\b[^"]*">/gi)];
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.index ?? source.length;
    return normalizeProject(marker, source.slice(marker.index, end), query, queryIndex);
  }).filter(Boolean);
}

export async function searchBehanceQuery(query, { queryIndex = 0, timeoutMs = 16000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${BEHANCE_SEARCH_URL}${encodeURIComponent(query)}?locale=en_US`;
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://www.behance.net/",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new BehanceSearchError(`Behance 搜索返回 HTTP ${response.status}`);
    const results = parseBehanceSearchHtml(await response.text(), query, queryIndex);
    if (!results.length) throw new BehanceSearchError("Behance 搜索响应中没有可用项目");
    return results;
  } catch (error) {
    if (error instanceof BehanceSearchError) throw error;
    if (error?.name === "AbortError") throw new BehanceSearchError("Behance 搜索超时", 504);
    throw new BehanceSearchError(`Behance 搜索失败：${error?.message || "未知错误"}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchBehanceQueries(queries, { concurrency = 2 } = {}) {
  const items = [];
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queries.length) {
      const queryIndex = cursor;
      const query = queries[cursor];
      cursor += 1;
      try {
        items.push(...await searchBehanceQuery(query, { queryIndex }));
      } catch (error) {
        failures.push({ query, error: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  if (!items.length && failures.length) {
    throw new BehanceSearchError(failures[0].error || "Behance 搜索暂时不可用");
  }
  return { items, failures };
}
