import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "app.js");

function extractFunction(source, name, bindings = {}) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `function ${name} not found in public/app.js`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let i = bodyStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(start, i + 1);
  const argNames = Object.keys(bindings);
  if (!argNames.length) return new Function(`return (${body})`)();
  const outer = new Function(...argNames, `return (${body})`);
  return outer(...argNames.map((key) => bindings[key]));
}

const appJs = await readFile(APP_JS, "utf-8");
const assetNameFromUrl = extractFunction(appJs, "assetNameFromUrl");
const normalizeAssetRecord = extractFunction(appJs, "normalizeAssetRecord", { assetNameFromUrl });

const SIGNED_URL =
  "https://refra-assets.oss-cn-shanghai.aliyuncs.com/outputs/kv-two-stage-1785835367585-146405.png?OSSAccessKeyId=LTAI5t7tuD6FAtUwJ3Yad61k&Expires=1785839662&Signature=nj7wtsEAgyrQFWzkbFSvUGtAJk4%3D";

test("assetNameFromUrl strips query string from signed URLs", () => {
  assert.equal(
    assetNameFromUrl(SIGNED_URL),
    "kv-two-stage-1785835367585-146405.png",
  );
});

test("assetNameFromUrl handles names that already contain query params", () => {
  assert.equal(
    assetNameFromUrl("kv-two-stage-1785835367585-146405.png?OSSAccessKeyId=abc&Expires=123&Signature=xyz"),
    "kv-two-stage-1785835367585-146405.png",
  );
});

test("assetNameFromUrl keeps a plain relative path filename", () => {
  assert.equal(assetNameFromUrl("/outputs/kv-two-stage-146405.png"), "kv-two-stage-146405.png");
  assert.equal(assetNameFromUrl(""), "");
});

test("normalizeAssetRecord derives clean name from object_key when name is a signed URL", () => {
  const record = normalizeAssetRecord({
    name: SIGNED_URL,
    url: SIGNED_URL,
    object_key: "outputs/kv-two-stage-1785835367585-146405.png",
  });
  assert.equal(record.name, "kv-two-stage-1785835367585-146405.png");
});

test("normalizeAssetRecord falls back to url basename without object_key", () => {
  const record = normalizeAssetRecord({ name: "", url: SIGNED_URL, object_key: "" });
  assert.equal(record.name, "kv-two-stage-1785835367585-146405.png");
});

test("normalizeAssetRecord keeps a clean name untouched", () => {
  const record = normalizeAssetRecord({
    name: "kv-two-stage-1785835367585-146405.png",
    url: SIGNED_URL,
    object_key: "outputs/kv-two-stage-1785835367585-146405.png",
  });
  assert.equal(record.name, "kv-two-stage-1785835367585-146405.png");
});
