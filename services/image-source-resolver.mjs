import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Unified image source resolver.
//
// The server receives browser-relative image URLs (e.g. `/style/真实人物/整合版式/
// Product_Vertical14.png`), `data:` URLs and plain `http(s)` URLs. Node's
// `fetch()` cannot resolve a browser-relative URL without a base URL, so every
// source type must be normalised here before bytes are sent to the image API.
//
// Local sources are mapped to the packaged repository directories (`/style/`,
// `/image/`, `/doudou/`, `/assets/`) or the writable runtime directories
// (`/uploads/`, `/outputs/`). Path traversal is rejected, and every result is
// validated for MIME type and maximum byte size.

export const ALLOWED_IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MAGIC_SIGNATURES = [
  { mime: "image/png", match: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" },
  { mime: "image/jpeg", match: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    mime: "image/webp",
    match: (bytes) => bytes.length >= 12
      && bytes.subarray(0, 4).toString("latin1") === "RIFF"
      && bytes.subarray(8, 12).toString("latin1") === "WEBP",
  },
  { mime: "image/gif", match: (bytes) => bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "GIF8" },
];

function detectImageType(bytes) {
  return MAGIC_SIGNATURES.find(({ match }) => match(bytes))?.mime || "";
}

function normalizeMime(raw) {
  const value = String(raw || "").split(";")[0].trim().toLowerCase();
  return [...ALLOWED_IMAGE_TYPES.values()].includes(value) ? value : "";
}

export function extensionForType(mime) {
  for (const [extension, value] of ALLOWED_IMAGE_TYPES) {
    if (value === mime) return extension;
  }
  return ".png";
}

function isWithin(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

// Decode a URL path segment by segment so an encoded `%2F` or `%2e%2e` cannot
// smuggle a traversal into a single filesystem segment.
function decodePathSegments(relativePath) {
  return relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      let decoded;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw new ImageSourceError("本地文件", relativePath, "路径包含非法 URL 编码");
      }
      if (decoded === "." || decoded === ".." || decoded.includes("\0")) {
        throw new ImageSourceError("本地文件", relativePath, "拒绝路径穿越");
      }
      if (decoded.includes("/") || decoded.includes(path.sep)) {
        throw new ImageSourceError("本地文件", relativePath, "拒绝路径穿越");
      }
      return decoded;
    });
}

function splitPrefix(source) {
  const match = String(source).match(/^(\/[^/]+)(\/.*)?$/);
  if (!match) return null;
  return { prefix: match[1], rest: match[2] || "" };
}

export class ImageSourceError extends Error {
  constructor(sourceType, safePath, detail) {
    const pathPart = safePath ? `, 路径=${safePath}` : "";
    super(`无法解析参考图来源（类型=${sourceType}${pathPart}）：${detail}`);
    this.name = "ImageSourceError";
    this.sourceType = sourceType;
    this.safePath = safePath;
  }
}

/**
 * Map a browser-relative or absolute image source to a local file.
 *
 * @param {string} source `/style/...`, `/uploads/...`, `/outputs/...` or an
 *   absolute filesystem path.
 * @param {object} roots Directory map: style, image, doudou, assets, uploads
 *   (string or array), outputs.
 * @returns {{kind:string, sourceType:string, file:string, base:string, url:string}|null}
 */
export function resolveLocalSource(source, roots = {}) {
  const raw = String(source || "").trim();
  if (!raw) return null;

  const prefixMapping = {
    "/style/": ["style", "style"],
    "/sytle/": ["style", "style"],
    "/image/": ["image", "image"],
    "/doudou/": ["doudou", "doudou"],
    "/assets/": ["assets", "assets"],
    "/uploads/": ["uploads", "uploads"],
    "/outputs/": ["outputs", "outputs"],
  };

  for (const [prefix, [rootKey, label]] of Object.entries(prefixMapping)) {
    if (!raw.startsWith(prefix)) continue;
    const relative = raw.slice(prefix.length);
    const segments = decodePathSegments(relative);
    const candidates = Array.isArray(roots[rootKey]) ? roots[rootKey] : [roots[rootKey]];
    let firstCandidate = null;
    for (const base of candidates) {
      if (!base) continue;
      const file = path.join(path.resolve(base), ...segments);
      if (!isWithin(base, file)) {
        throw new ImageSourceError("本地文件", raw, "拒绝路径穿越");
      }
      const candidate = {
        kind: "local",
        sourceType: label,
        file,
        base: path.resolve(base),
        url: raw,
      };
      firstCandidate ||= candidate;
      // Prefer a root that actually contains the file (writable runtime root
      // first, packaged copy second on Vercel).
      if (existsSync(file)) return candidate;
    }
    if (firstCandidate) return firstCandidate;
    throw new ImageSourceError("本地文件", raw, "未配置该来源目录");
  }

  // Absolute filesystem paths (e.g. the stage-one output written to
  // /tmp/refra/outputs on Vercel) are allowed when they stay inside a
  // configured root.
  if (path.isAbsolute(raw)) {
    const rootCandidates = [];
    for (const rootKey of ["style", "image", "doudou", "assets", "uploads", "outputs"]) {
      const values = Array.isArray(roots[rootKey]) ? roots[rootKey] : [roots[rootKey]];
      for (const base of values) {
        if (base) rootCandidates.push({ base: path.resolve(base), label: rootKey });
      }
    }
    for (const { base, label } of rootCandidates) {
      if (isWithin(base, raw)) {
        return {
          kind: "local",
          sourceType: label,
          file: path.resolve(raw),
          base,
          url: raw,
        };
      }
    }
    throw new ImageSourceError("本地文件", raw, "绝对路径不在允许目录内");
  }

  return null;
}

async function readLocalFile(local, maxBytes = MAX_IMAGE_BYTES) {
  const fileStat = await stat(local.file).catch(() => null);
  if (!fileStat) {
    throw new ImageSourceError("本地文件", local.url, `文件不存在（目录=${local.sourceType}）`);
  }
  if (!fileStat.isFile()) {
    throw new ImageSourceError("本地文件", local.url, "目标不是普通文件");
  }
  if (fileStat.size > maxBytes) {
    throw new ImageSourceError("本地文件", local.url, `文件超过大小限制 ${maxBytes} 字节`);
  }
  const bytes = await readFile(local.file);
  const mime = detectImageType(bytes) || normalizeMime(ALLOWED_IMAGE_TYPES.get(path.extname(local.file).toLowerCase()));
  if (!mime) {
    throw new ImageSourceError("本地文件", local.url, "文件不是受支持的图片格式");
  }
  return { bytes, type: mime };
}

function parseDataUrl(source, maxBytes = MAX_IMAGE_BYTES) {
  const match = String(source).match(/^data:([^,;]+)(?:;base64)?,(.*)$/s);
  if (!match) throw new ImageSourceError("data URL", "", "格式无效");
  const mime = normalizeMime(match[1]);
  if (!mime) throw new ImageSourceError("data URL", "", "MIME 类型不是受支持的图片格式");
  const payload = match[2];
  let bytes;
  try {
    bytes = /;base64/i.test(source.split(",")[0])
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "binary");
  } catch {
    throw new ImageSourceError("data URL", "", "载荷解码失败");
  }
  if (!bytes.length) throw new ImageSourceError("data URL", "", "载荷为空");
  if (bytes.length > maxBytes) {
    throw new ImageSourceError("data URL", "", `载荷超过大小限制 ${maxBytes} 字节`);
  }
  const sniffed = detectImageType(bytes);
  if (!sniffed) throw new ImageSourceError("data URL", "", "载荷不是受支持的图片格式");
  return { bytes, type: sniffed };
}

async function fetchHttpSource(source, maxBytes = MAX_IMAGE_BYTES, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(source);
  } catch (error) {
    throw new ImageSourceError("网络图片", source, `下载失败：${error.message}`);
  }
  if (!response.ok) {
    throw new ImageSourceError("网络图片", source, `下载失败：HTTP ${response.status}`);
  }
  const declaredType = normalizeMime(response.headers.get("content-type"));
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new ImageSourceError("网络图片", source, `文件超过大小限制 ${maxBytes} 字节`);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new ImageSourceError("网络图片", source, `文件超过大小限制 ${maxBytes} 字节`);
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const sniffed = detectImageType(bytes);
  const type = sniffed || declaredType;
  if (!type) {
    throw new ImageSourceError("网络图片", source, "响应不是受支持的图片格式");
  }
  return { bytes, type };
}

// Build an absolute URL for the same deployment's public static file. The
// browser-relative path must stay on the configured origin so a crafted source
// cannot redirect the server to an arbitrary host.
function buildDeploymentUrl(source, deploymentBaseUrl) {
  const base = String(deploymentBaseUrl || "").trim();
  if (!base) return null;
  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) return null;
  let target;
  try {
    target = new URL(source, baseUrl);
  } catch {
    return null;
  }
  if (target.origin !== baseUrl.origin) return null;
  return target;
}

/**
 * Resolve any supported image source to raw bytes and MIME type.
 *
 * @param {string} source
 * @param {object} options `roots` directory map, optional `maxBytes`,
 *   optional `fetchImpl` for tests, optional `deploymentBaseUrl` used as a
 *   fallback when a local repository file is missing from the function bundle
 *   (the Vercel static files are served by the deployment edge, not the
 *   function filesystem).
 * @returns {Promise<{bytes:Buffer, type:string, kind:string, sourceType:string, safePath:string}>}
 */
export async function resolveImageBytes(source, options = {}) {
  const raw = String(source || "").trim();
  if (!raw) {
    throw new ImageSourceError("未知来源", "", "缺少图片来源");
  }
  const maxBytes = options.maxBytes || MAX_IMAGE_BYTES;
  const deploymentBaseUrl = options.deploymentBaseUrl || "";

  if (/^https?:\/\//i.test(raw)) {
    const result = await fetchHttpSource(raw, maxBytes, options.fetchImpl);
    return { ...result, kind: "remote", sourceType: "网络图片", safePath: raw };
  }
  if (raw.startsWith("data:")) {
    const result = parseDataUrl(raw, maxBytes);
    return { ...result, kind: "data", sourceType: "data URL", safePath: `data:${result.type} (${result.bytes.length} 字节)` };
  }

  const local = resolveLocalSource(raw, options.roots || {});
  if (local) {
    const fileStat = await stat(local.file).catch(() => null);
    if (fileStat) {
      const result = await readLocalFile(local, maxBytes);
      return { ...result, kind: "local", sourceType: local.sourceType, safePath: local.url };
    }
    const fallbackUrl = buildDeploymentUrl(raw, deploymentBaseUrl);
    if (fallbackUrl) {
      const result = await fetchHttpSource(fallbackUrl.href, maxBytes, options.fetchImpl);
      return {
        ...result,
        kind: "remote",
        sourceType: local.sourceType,
        safePath: local.url,
        url: fallbackUrl.href,
      };
    }
    throw new ImageSourceError("本地文件", local.url, `文件不存在（目录=${local.sourceType}）`);
  }
  throw new ImageSourceError("未知来源", raw, "不支持的图片来源格式");
}

export const __testing = {
  buildDeploymentUrl,
  decodePathSegments,
  detectImageType,
  isWithin,
  normalizeMime,
  splitPrefix,
};
