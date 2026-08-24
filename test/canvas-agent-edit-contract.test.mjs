import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, canvas, index, styles, server, splitIcon, downloadIcon, newChatIcon] = await Promise.all([
  readFile(path.join(root, "public", "app.js"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
  readFile(path.join(root, "public", "index.html"), "utf-8"),
  readFile(path.join(root, "public", "styles.css"), "utf-8"),
  readFile(path.join(root, "server.mjs"), "utf-8"),
  readFile(path.join(root, "public", "ui-assets", "icon", "canvas-split.svg"), "utf-8"),
  readFile(path.join(root, "public", "ui-assets", "icon", "canvas-download.svg"), "utf-8"),
  readFile(path.join(root, "public", "ui-assets", "icon", "canvas-new-chat.svg"), "utf-8"),
]);

test("home inspiration discovery is hidden and no longer requested on canvas return", () => {
  assert.match(index, /id="homeInspirationModule" class="home-module hidden" aria-hidden="true"/);
  assert.match(app, /if \(homeInspirationModule\?\.classList\.contains\("hidden"\)\) return;/);
  const returnedHome = app.slice(app.indexOf("window.__canvasReturnedHome"), app.indexOf("window.__saveCanvasRequested"));
  assert.doesNotMatch(returnedHome, /loadHomeInspiration/);
});

test("generation exposes a ratio-aware 12px shimmer node", () => {
  assert.match(canvas, /function LoadingNode/);
  assert.match(canvas, /canvasAspectRatio\(payload\.image_size/);
  assert.match(canvas, /"图片正在生成中\.\.\.\.\.\."/);
  assert.match(styles, /\.cf-generation-loading-card\s*\{[\s\S]*?border-radius: 12px;/);
  assert.match(styles, /animation: canvasGenerationShimmer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("canvas supports node undo and redo without graph edges", () => {
  assert.match(canvas, /undoStackRef/);
  assert.match(canvas, /redoStackRef/);
  assert.match(canvas, /event\.shiftKey\) redo\(\)/);
  assert.match(canvas, /else undo\(\)/);
  assert.match(canvas, /edges=\{\[\]\}/);
  assert.doesNotMatch(canvas, /useEdgesState|onEdgesChange|<Handle/);
});

test("home and canvas composers paste images and canvas starts a clean conversation", () => {
  assert.match(app, /window\.__addReferenceFiles = addReferenceFiles/);
  assert.match(app, /function handleVisualDescriptionPaste\(event\)/);
  assert.match(app, /pastedImageFiles\(event\.clipboardData\)/);
  assert.match(app, /visualDescriptionInput\.addEventListener\("paste", handleVisualDescriptionPaste\)/);
  assert.match(canvas, /event\.clipboardData\?\.items/);
  assert.match(canvas, /onPaste=\{handleComposerPaste\}/);
  assert.match(canvas, /className="cf-chat-new"/);
  assert.match(canvas, /setAllMessages\(\[\]\)/);
  assert.match(canvas, /setNewConversationPending\(true\)/);
  assert.match(canvas, /newConversationPending \? null : selectedNode/);
  assert.match(newChatIcon, /<svg/);
});

test("follow-up chat edits the selected project image with bounded history", () => {
  assert.match(canvas, /请先在画布中选择一张图片，再继续编辑/);
  assert.match(canvas, /edit_mode: baseNode \? "true" : "false"/);
  assert.match(canvas, /base_image_object_key/);
  assert.match(canvas, /conversation_history: JSON\.stringify\(conversationHistory\)/);
  assert.match(server, /function buildCanvasEditPrompt/);
  assert.match(server, /图 1 是当前选中的完整基础图，也是最高优先级固定画布/);
  assert.match(server, /projectImageElement\(request\.project_id/);
  assert.match(server, /generation_mode: "canvas-edit"/);
});

test("selected image branding creates a protected derivative and toolbar icons are supplied", () => {
  assert.match(canvas, /抖音商城logo/);
  assert.match(canvas, /\/api\/assets\/brand-overlay/);
  assert.match(server, /url\.pathname === "\/api\/assets\/brand-overlay"/);
  assert.match(server, /include_logo: true/);
  assert.match(server, /include_search_overlay: true/);
  assert.match(splitIcon, /<svg/);
  assert.match(downloadIcon, /<svg/);
  assert.match(server, /"\.svg": "image\/svg\+xml; charset=utf-8"/);
});

test("Figma typography loads the supplied fonts and normalizes UI copy to weight 450", () => {
  assert.match(styles, /DouyinNumberABC-Medium\.otf/);
  assert.match(styles, /DouYinFaXianSansBold\.otf/);
  assert.match(styles, /:where\([\s\S]*?font-weight: 450 !important;/);
  assert.match(styles, /#stylePickerButton\.active[\s\S]*?color: #00cae0;/i);
  assert.match(server, /"\.otf": "font\/otf"/);
});
