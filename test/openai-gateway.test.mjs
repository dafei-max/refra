import test from "node:test";
import assert from "node:assert/strict";
import {
  coreImageGenerationBody,
  isByteDanceModelHub,
  normalizeImageApiSize,
  normalizeOpenAiBaseUrl,
  openAiHeaders,
} from "../services/openai-gateway.mjs";

test("ModelHub uses both SDK-compatible auth headers without query secrets", () => {
  const baseUrl = "https://aidp.bytedance.net/api/modelhub/online/v2/crawl/openai/";
  assert.equal(normalizeOpenAiBaseUrl(baseUrl), baseUrl.slice(0, -1));
  assert.equal(isByteDanceModelHub(baseUrl), true);
  assert.deepEqual(openAiHeaders({ apiKey: "secret", baseUrl, contentType: "application/json", logId: "safe-log-id" }), {
    Authorization: "Bearer secret",
    "api-key": "secret",
    "Content-Type": "application/json",
    "X-TT-LOGID": "safe-log-id",
  });
});

test("official-compatible endpoints only receive Bearer auth", () => {
  assert.equal(isByteDanceModelHub("https://api.openai.com/v1"), false);
  assert.deepEqual(openAiHeaders({ apiKey: "secret", baseUrl: "https://api.openai.com/v1" }), {
    Authorization: "Bearer secret",
  });
});

test("legacy aspect sizes map to the three sizes accepted by the image gateway", () => {
  assert.equal(normalizeImageApiSize("1024x1024"), "1024x1024");
  assert.equal(normalizeImageApiSize("1536x864"), "1536x1024");
  assert.equal(normalizeImageApiSize("960x1280"), "1024x1536");
  assert.equal(normalizeImageApiSize("768x1024"), "1024x1536");
  assert.equal(normalizeImageApiSize("auto"), "auto");
  assert.deepEqual(coreImageGenerationBody({
    model: "gpt-image-2",
    prompt: "test",
    size: "960x1280",
    quality: "low",
  }), {
    model: "gpt-image-2",
    prompt: "test",
    n: 1,
    size: "1024x1536",
    quality: "low",
  });
});
