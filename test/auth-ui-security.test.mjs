import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [appJs, canvasJsx, indexHtml, server] = await Promise.all([
  readFile(path.join(root, "public", "app.js"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
  readFile(path.join(root, "public", "index.html"), "utf-8"),
  readFile(path.join(root, "server.mjs"), "utf-8"),
]);

test("admin token is scoped to session storage and never falls back to prompt", () => {
  assert.match(appJs, /sessionStorage\.getItem\(ADMIN_TOKEN_KEY\)/);
  assert.match(canvasJsx, /sessionStorage\.getItem\("refra_admin_token"\)/);
  assert.doesNotMatch(appJs, /localStorage\.(?:getItem|setItem)\(ADMIN_TOKEN_KEY/);
  assert.doesNotMatch(appJs, /window\.prompt\(/);
  assert.doesNotMatch(indexHtml, /id="adminTokenInput"/);
});

test("invite validates through the dedicated bearer-only endpoint", () => {
  assert.match(appJs, /fetch\("\/api\/auth\/verify"/);
  assert.match(server, /url\.pathname === "\/api\/auth\/verify"/);
  assert.match(server, /header\.startsWith\("Bearer "\)/);
  assert.match(server, /jsonResponse\(res, 200, \{ ok: true \}\)/);
});

test("invite uses a separate masked presentation layer", () => {
  assert.match(indexHtml, /id="inviteTokenDisplay"/);
  assert.match(appJs, /function maskAdminToken\(/);
  assert.match(appJs, /"•"\.repeat/);
});
