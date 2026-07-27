const ALLOWED_HOSTS = new Map([
  ["i.pinimg.com", "https://www.pinterest.com/"],
  ["mir-s3-cdn-cf.behance.net", "https://www.behance.net/"],
  ["mir-s3-cdn.behance.net", "https://www.behance.net/"],
]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ITEMS = 48;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const cache = new Map();

export class ImageProxyError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "ImageProxyError";
    this.statusCode = statusCode;
  }
}

function validateImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw new ImageProxyError("图片地址无效", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ImageProxyError("图片协议不受支持", 400);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ImageProxyError("该图片来源不在允许列表中", 403);
  }
  if (parsed.username || parsed.password || (parsed.port && !["80", "443"].includes(parsed.port))) {
    throw new ImageProxyError("图片地址包含不安全参数", 400);
  }
  return parsed;
}

function cached(url) {
  const item = cache.get(url);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    cache.delete(url);
    return null;
  }
  cache.delete(url);
  cache.set(url, item);
  return item;
}

function remember(url, item) {
  cache.set(url, { ...item, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ITEMS) cache.delete(cache.keys().next().value);
}

async function fetchSafe(url, redirectsLeft = 2) {
  const response = await fetch(url, {
    headers: {
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0 Safari/537.36",
      "Referer": ALLOWED_HOSTS.get(new URL(url).hostname.toLowerCase()),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    if (!redirectsLeft) throw new ImageProxyError("图片重定向次数过多");
    const location = response.headers.get("location");
    if (!location) throw new ImageProxyError("图片重定向缺少地址");
    const nextUrl = validateImageUrl(new URL(location, url).href);
    return fetchSafe(nextUrl, redirectsLeft - 1);
  }
  return response;
}

async function readLimitedBody(response) {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new ImageProxyError("图片超过 8MB 限制", 413);
  if (!response.body) throw new ImageProxyError("图片响应为空");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImageProxyError("图片超过 8MB 限制", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function getInspirationImage(rawUrl) {
  const url = validateImageUrl(rawUrl).href;
  const hit = cached(url);
  if (hit) return hit;

  let response;
  try {
    response = await fetchSafe(url);
  } catch (error) {
    if (error instanceof ImageProxyError) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ImageProxyError("图片加载超时", 504);
    }
    throw new ImageProxyError(`图片加载失败：${error?.message || "未知错误"}`);
  }
  if (!response.ok) throw new ImageProxyError(`图片返回 HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new ImageProxyError("远程响应不是图片", 415);
  const item = { buffer: await readLimitedBody(response), contentType };
  remember(url, item);
  return item;
}

export const getPinterestImage = getInspirationImage;
