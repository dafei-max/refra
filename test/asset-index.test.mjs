import assert from "node:assert/strict";
import test from "node:test";

import { assetObjectKey, compactAssetIndexRecord } from "../services/asset-index.mjs";

test("assetObjectKey rejects inline data while preserving stable OSS keys", () => {
  assert.equal(assetObjectKey("data:image/png;base64,abc"), "");
  assert.equal(assetObjectKey("blob:https://example.com/id"), "");
  assert.equal(assetObjectKey("/uploads/materials/a.png"), "uploads/materials/a.png");
  assert.equal(
    assetObjectKey("https://refra-assets.oss-cn-shanghai.aliyuncs.com/outputs/a.png?Expires=1&Signature=x"),
    "outputs/a.png",
  );
});

test("asset index compaction drops repeated retrieval snapshots but retains project-critical metadata", () => {
  const compact = compactAssetIndexRecord({
    name: "kv.png",
    object_key: "outputs/kv.png",
    title: "活动标题",
    description: "brief",
    references: ["data:image/png;base64,very-large", "/uploads/materials/ref.png"],
    retrieval: { preset_references: [{ description: "x".repeat(200_000) }] },
    creative_plan: { candidates: [{ reason: "y".repeat(20_000) }] },
    optimization_status: "completed",
    layers: { scene: { object_key: "outputs/kv.png", url: "stale-signed-url" } },
    split: { title_layer: { object_key: "outputs/title.png" } },
  });

  assert.equal(compact.object_key, "outputs/kv.png");
  assert.deepEqual(compact.references, ["uploads/materials/ref.png"]);
  assert.equal(compact.optimization_status, "completed");
  assert.equal(compact.layers.scene.object_key, "outputs/kv.png");
  assert.equal(compact.split.title_layer.object_key, "outputs/title.png");
  assert.equal("retrieval" in compact, false);
  assert.equal("creative_plan" in compact, false);
  assert.ok(JSON.stringify(compact).length < 10_000);
});
