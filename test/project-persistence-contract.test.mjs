import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [server, canvas] = await Promise.all([
  readFile(path.join(root, "server.mjs"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
]);

test("legacy asset migration creates one Untitled canvas node and remains index-gated", () => {
  assert.match(server, /if \(projects !== null\) return projects;/);
  assert.match(server, /title: "Untitled"/);
  assert.match(server, /elements: asset\.object_key\s*\? \[\{ id: newProjectElementId\(\), kind: "kv"/);
});

test("canvas persistence carries graph, viewport, messages and generation settings", () => {
  assert.match(server, /async function saveProjectCanvas\(projectId, \{ title, elements, edges, viewport, settings, messages \}\)/);
  assert.match(canvas, /edges: edgesRef\.current\.map/);
  assert.match(canvas, /viewport: viewportRef\.current/);
  assert.match(canvas, /messages: messagesRef\.current\.map/);
  assert.match(canvas, /settings: typeof window\.__getCanvasSettings/);
});

test("persisted message images use object keys and are signed only for reads", () => {
  assert.match(server, /image_object_key: textOf\(message\.image_object_key\)/);
  assert.match(server, /image_url: message\.image_object_key \? storageSignUrl/);
  assert.doesNotMatch(server, /image: textOf\(message\.image\)/);
});

test("split requests reuse stored layers before invoking image generation", () => {
  const reuseIndex = server.indexOf("savedSplit?.title_layer?.object_key");
  const generationIndex = server.indexOf("if (!OPENAI_API_KEY)", reuseIndex);
  assert.ok(reuseIndex >= 0);
  assert.ok(generationIndex > reuseIndex);
  assert.match(server.slice(reuseIndex, generationIndex), /reused: true/);
});
