import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, canvas, index, styles, server] = await Promise.all([
  readFile(path.join(root, "public", "app.js"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
  readFile(path.join(root, "public", "index.html"), "utf-8"),
  readFile(path.join(root, "public", "styles.css"), "utf-8"),
  readFile(path.join(root, "server.mjs"), "utf-8"),
]);

test("admin token masking does not register as a browser password field", () => {
  assert.match(index, /id="inviteTokenInput" type="text"/);
  assert.match(index, /autocomplete="off"/);
  assert.doesNotMatch(index, /id="inviteTokenInput" type="password"/);
  assert.match(app, /"•"\.repeat\(32\)/);
  assert.match(styles, /\.invite-card\s*\{[\s\S]*?box-shadow: none;/);
});

test("canvas uses the supplied control, collapse, upload and run assets", () => {
  for (const asset of [
    "canvas-minimap.png",
    "canvas-zoom-out.png",
    "canvas-zoom-in.png",
    "canvas-collapse.png",
    "canvas-upload.png",
  ]) assert.match(canvas, new RegExp(asset.replace(".", "\\.")));
  assert.match(canvas, /\/ui-assets\/runButton\.png/);
});

test("canvas composer exposes upload previews, a native size popover and expansion feedback", () => {
  assert.match(app, /refra:canvas-references/);
  assert.match(app, /refra:canvas-expand/);
  assert.match(canvas, /cf-composer-references/);
  assert.match(canvas, /cf-canvas-size-popover/);
  assert.match(canvas, /composerExpanding \? "扩写中" : "扩写"/);
  assert.match(canvas, /window\.__setCanvasImageSize/);
});

test("Doudou is derived exclusively from the visual description", () => {
  const functionStart = server.indexOf("function isDoudouEnabled");
  const functionEnd = server.indexOf("function booleanPreference", functionStart);
  const body = server.slice(functionStart, functionEnd);
  assert.match(body, /\/兜兜\/\.test\(textOf\(request\.visual_description\)\)/);
  assert.doesNotMatch(body, /request\.doudou_ip/);
  assert.match(server, /include_logo: booleanPreference\(body\.include_logo, false\)/);
  assert.match(server, /include_search_overlay: booleanPreference\(body\.include_search_overlay, false\)/);
});

test("selected canvas nodes are image-only and shadowless", () => {
  assert.doesNotMatch(canvas, /className="cf-node-label"/);
  assert.match(styles, /\.canvas-page \.cf-node\s*\{[\s\S]*?box-shadow: none;/);
  assert.match(styles, /background: rgba\(15, 15, 15, 0\.72\)/);
  assert.match(styles, /rgba\(255, 255, 255, 0\.08\) 1px/);
});
