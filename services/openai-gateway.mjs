const STANDARD_IMAGE_SIZES = new Set([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "auto",
]);

export function normalizeOpenAiBaseUrl(value, fallback = "https://api.openai.com/v1") {
  return String(value || fallback).trim().replace(/\/+$/, "");
}

export function isByteDanceModelHub(baseUrl) {
  try {
    return new URL(normalizeOpenAiBaseUrl(baseUrl)).hostname === "aidp.bytedance.net";
  } catch {
    return false;
  }
}

export function openAiHeaders({ apiKey, baseUrl, contentType = "", logId = "" }) {
  const key = String(apiKey || "").trim();
  const headers = {};
  if (key) {
    // The OpenAI SDK always sends Bearer auth. ByteDance ModelHub additionally
    // documents the api-key header, so use both without putting the AK in URLs.
    headers.Authorization = `Bearer ${key}`;
    if (isByteDanceModelHub(baseUrl)) headers["api-key"] = key;
  }
  if (contentType) headers["Content-Type"] = contentType;
  if (logId && isByteDanceModelHub(baseUrl)) headers["X-TT-LOGID"] = logId;
  return headers;
}

export function normalizeImageApiSize(value, fallback = "1024x1024") {
  const requested = String(value || fallback).trim().toLowerCase();
  if (STANDARD_IMAGE_SIZES.has(requested)) return requested;
  const match = requested.match(/^(\d+)x(\d+)$/);
  if (!match) return STANDARD_IMAGE_SIZES.has(fallback) ? fallback : "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

export function coreImageGenerationBody({ model, prompt, size, quality }) {
  return {
    model,
    prompt,
    n: 1,
    size: normalizeImageApiSize(size),
    quality,
  };
}

export const __openAiGatewayTesting = {
  standardImageSizes: [...STANDARD_IMAGE_SIZES],
};
