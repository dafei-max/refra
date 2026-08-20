import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("history project cards open a restorable canvas in a new tab", async () => {
  const app = await readFile(path.join(root, "public", "app.js"), "utf-8");
  assert.match(app, /function openProjectInNewTab\(projectId\)/);
  assert.match(app, /window\.open\(projectLocation\(projectId\)\.href, "_blank"\)/);
  assert.match(app, /openProjectInNewTab\(card\.dataset\.projectId\)/);
  assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\("projectId"\)/);
  assert.match(app, /await openCanvas\(initialProjectId\)/);
  assert.match(app, /window\.history\.replaceState\(null, "", projectLocation\(projectId\)\)/);
  assert.match(app, /if \(view !== "canvas"\) clearProjectLocation\(\)/);
});

test("new project creation remains in the current tab", async () => {
  const app = await readFile(path.join(root, "public", "app.js"), "utf-8");
  assert.match(app, /async function createProject\(\)[\s\S]*?await openCanvas\(payload\.id\);/);
  assert.doesNotMatch(app, /async function createProject\(\)[\s\S]*?openProjectInNewTab\(payload\.id\)/);
});
