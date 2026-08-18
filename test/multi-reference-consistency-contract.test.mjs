import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, canvas, styles, server] = await Promise.all([
  readFile(path.join(root, "public", "app.js"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
  readFile(path.join(root, "public", "styles.css"), "utf-8"),
  readFile(path.join(root, "server.mjs"), "utf-8"),
]);

test("home and canvas expose every uploaded reference through scrollable mention menus", () => {
  assert.match(app, /REFERENCE_UPLOAD_MAX_COUNT = 9/);
  assert.match(app, /label: `图\$\{nextReferenceNumber\+\+\}`/);
  assert.match(app, /选择参考图（\$\{matchingReferences\.length\}\/\$\{referenceFiles\.length\}）/);
  assert.match(canvas, /composerMentionRange/);
  assert.match(canvas, /cf-composer-mention-menu/);
  assert.match(styles, /\.mention-menu\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /\.cf-composer-mention-menu\s*\{[\s\S]*?overflow-y: auto;/);
});

test("canvas sends indexed multipart files and matching stable labels", () => {
  assert.match(canvas, /body\.append\("reference_labels", JSON\.stringify\(referenceLabels\)\)/);
  assert.match(canvas, /body\.append\(`reference_image_\$\{index\}`/);
  assert.doesNotMatch(canvas, /body\.append\("reference_image", file/);
  assert.match(server, /while \(files\[fileKey\]\) fileKey = `\$\{name\}_\$\{duplicateIndex\+\+\}`/);
});

test("generation prompts bind product and person references to distinct identities", () => {
  assert.match(server, /同一位真人的唯一身份来源/);
  assert.match(server, /不得换脸/);
  assert.match(server, /同一件产品\/SKU的唯一身份来源/);
  assert.match(server, /不得换成同类替代品或重新设计包装/);
  assert.match(server, /不同参考图分别约束对应主体/);
  assert.match(server, /\.\.\.finalKvReferenceLines\(selected, 1\)/);
});
