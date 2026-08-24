import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const runButton = await readFile(path.join(root, "public", "ui-assets", "runButton.png"));

test("admin token masking does not register as a browser password field", () => {
  assert.match(index, /id="inviteTokenInput" type="text"/);
  assert.match(index, /autocomplete="off"/);
  assert.doesNotMatch(index, /id="inviteTokenInput" type="password"/);
  assert.match(app, /"•"\.repeat\(32\)/);
  assert.match(styles, /\.invite-card\s*\{[\s\S]*?box-shadow: none;/);
});

test("canvas uses the supplied control, collapse, SVG composer and run assets", () => {
  for (const asset of [
    "canvas-minimap.png",
    "canvas-zoom-out.png",
    "canvas-zoom-in.png",
    "canvas-collapse.png",
  ]) assert.match(canvas, new RegExp(asset.replace(".", "\\.")));
  for (const asset of ["uploadTrigger.svg", "stylePickerIcon.svg", "expandDescriptionButton.svg", "mention-at.svg"]) {
    assert.match(`${canvas}\n${styles}`, new RegExp(asset.replace(".", "\\.")));
  }
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

test("project cards expose Figma menu actions and protected rename/delete flows", () => {
  assert.match(app, /class="project-menu-trigger"/);
  assert.match(app, /project-more\.png/);
  assert.doesNotMatch(app, /project-more\.svg/);
  assert.match(app, /data-project-rename/);
  assert.match(app, /data-project-delete/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(index, /id="projectActionModal"/);
  assert.match(index, /id="projectDeleteCopy"/);
  assert.match(styles, /background: rgba\(234, 97, 83, 0\.2\)/);
});

test("project and inspiration modules use reduced-motion-aware shimmer loading shells", () => {
  assert.match(app, /renderProjectSkeletons/);
  assert.match(app, /renderHomeInspirationSkeletons/);
  assert.match(styles, /@keyframes uiSkeletonSweep/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /backdrop-filter: blur\(24px\)/);
});

test("run button uses the supplied notification artwork", () => {
  const digest = createHash("sha256").update(runButton).digest("hex");
  assert.equal(digest, "3643c38971d70eca8f0ba0dd42c196eaf0dccd729f5c3bf85183d6804553dabb");
});
