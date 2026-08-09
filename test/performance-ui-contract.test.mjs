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

test("minimap uses one Figma-sized shell around the React Flow viewport", () => {
  assert.match(canvas, /style=\{\{ width: 176, height: 106, background: "#fffffd" \}\}/);
  assert.match(canvas, /maskColor="transparent"/);
  assert.match(styles, /\.react-flow__minimap\s*\{[\s\S]*?width: 200px !important;[\s\S]*?height: 130px !important;[\s\S]*?padding: 12px;/);
  assert.match(styles, /\.react-flow__minimap-svg\s*\{[\s\S]*?width: 176px !important;[\s\S]*?height: 106px !important;/);
});

test("canvas bundle loads on demand instead of blocking the homepage", () => {
  assert.doesNotMatch(index, /<script src="\/canvas-app\.js"><\/script>/);
  assert.match(app, /function ensureCanvasApp\(\)/);
  assert.match(app, /script\.src = "\/canvas-app\.js"/);
  const bootBody = app.slice(app.indexOf("async function boot()"), app.indexOf("function projectUpdatedLabel"));
  assert.doesNotMatch(bootBody, /loadLibrary\(\)/);
  assert.match(bootBody, /Promise\.allSettled/);
});

test("homepage material payload is bounded and public static files are CDN-cacheable", () => {
  assert.match(app, /new URLSearchParams\(\{ limit: "10" \}\)/);
  assert.match(server, /url\.searchParams\.get\("role"\)/);
  assert.match(server, /Math\.min\(100, Math\.floor\(requestedLimit\)\)/);
  assert.match(server, /s-maxage=31536000/);
  assert.match(server, /serveStatic\(res, path\.join\(PUBLIC_DIR,[\s\S]*cacheControl: PUBLIC_STATIC_CACHE_CONTROL/);
});
