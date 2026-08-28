const DEFAULT_IMAGE_BASE_URL = "https://www.rightapi.ai/draw/v1";
const DEFAULT_TASK_BASE_URL = "https://www.rightapi.ai/v1";
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_RESULT_BYTES = 32 * 1024 * 1024;

function withoutTrailingSlash(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

function errorMessage(payload, fallback) {
  return String(payload?.error?.message || payload?.message || fallback);
}

function imageDataUrl(image) {
  const mime = String(image?.type || "image/png");
  const bytes = Buffer.isBuffer(image?.bytes) ? image.bytes : Buffer.from(image?.bytes || []);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function resultCandidate(payload = {}) {
  const first = Array.isArray(payload.data) ? payload.data[0] : null;
  if (first?.b64_json) return { b64: String(first.b64_json), url: "" };
  if (first?.url) return { b64: "", url: String(first.url) };
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const url = parts.map((part) => part?.text).find((value) => /^https?:\/\//i.test(String(value || "")));
    if (url) return { b64: "", url: String(url) };
    const inline = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
    if (inline) return { b64: String(inline.inlineData?.data || inline.inline_data?.data), url: "" };
  }
  return null;
}

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(payload, `RightAPI 请求失败：HTTP ${response.status}`));
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("RightAPI 请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadResult(fetchImpl, candidate, timeoutMs) {
  if (candidate.b64) return candidate.b64;
  const url = new URL(candidate.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("RightAPI 返回了不安全的图片地址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`RightAPI 结果图片下载失败：HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_RESULT_BYTES) throw new Error("RightAPI 返回的图片超过大小限制");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("RightAPI 返回的图片为空");
    if (bytes.length > MAX_RESULT_BYTES) throw new Error("RightAPI 返回的图片超过大小限制");
    return bytes.toString("base64");
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("RightAPI 结果图片下载超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildRightApiImageRequest({
  model = "gpt-image-2",
  prompt,
  size = "1024x1024",
  images = [],
}) {
  const request = {
    model,
    prompt: String(prompt || "").trim(),
    n: 1,
    size,
    async: true,
  };
  if (/nano-banana|vip/i.test(model)) request.imageSize = "1K";
  if (!request.prompt) throw new Error("RightAPI 生图缺少 Prompt");
  if (images.length) request.image = images.map(imageDataUrl);
  return request;
}

export async function generateRightApiImage({
  apiKey,
  model = "gpt-image-2",
  prompt,
  size = "1024x1024",
  images = [],
  imageBaseUrl = DEFAULT_IMAGE_BASE_URL,
  taskBaseUrl = DEFAULT_TASK_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = null,
}) {
  const token = String(apiKey || "").trim();
  if (!token) throw new Error("缺少 RIGHTAPI_API_KEY");
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
  const submitted = await fetchJson(
    fetchImpl,
    `${withoutTrailingSlash(imageBaseUrl, DEFAULT_IMAGE_BASE_URL)}/images/generations`,
    { method: "POST", headers, body: JSON.stringify(buildRightApiImageRequest({ model, prompt, size, images })) },
    Math.min(timeoutMs, 30_000),
  );
  let candidate = resultCandidate(submitted);
  if (candidate) return { b64: await downloadResult(fetchImpl, candidate, 30_000), taskId: "", provider: "rightapi" };

  const taskId = String(submitted.task_id || "").trim();
  if (!taskId) throw new Error(errorMessage(submitted, "RightAPI 未返回 task_id"));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleepImpl(pollIntervalMs);
    const task = await fetchJson(
      fetchImpl,
      `${withoutTrailingSlash(taskBaseUrl, DEFAULT_TASK_BASE_URL)}/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { "Authorization": `Bearer ${token}` } },
      Math.min(30_000, Math.max(1_000, timeoutMs - (Date.now() - startedAt))),
    );
    if (onProgress) onProgress({ status: task.status || "in_progress", progress: Number(task.progress || 0) });
    candidate = resultCandidate(task);
    if (candidate) {
      return {
        b64: await downloadResult(fetchImpl, candidate, 30_000),
        taskId,
        provider: "rightapi",
      };
    }
    if (task.status === "failed") throw new Error(errorMessage(task, "RightAPI 图片生成失败"));
  }
  throw new Error(`RightAPI 图片生成超时（task_id: ${taskId}）`);
}

export const RIGHTAPI_IMAGE_DEFAULTS = Object.freeze({
  imageBaseUrl: DEFAULT_IMAGE_BASE_URL,
  taskBaseUrl: DEFAULT_TASK_BASE_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
});
