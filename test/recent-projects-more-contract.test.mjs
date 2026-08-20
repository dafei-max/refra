import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("recent projects uses the supplied right arrow icon", async () => {
  const [index, styles, icon] = await Promise.all([
    readFile(path.join(root, "public", "index.html"), "utf-8"),
    readFile(path.join(root, "public", "styles.css"), "utf-8"),
    readFile(path.join(root, "public", "ui-assets", "icon", "right.svg"), "utf-8"),
  ]);
  assert.match(index, /id="recentProjectsMore"[\s\S]*?<span>查看全部<\/span><img src="\/ui-assets\/icon\/right\.svg"/);
  assert.doesNotMatch(index, /id="recentProjectsMore"[^>]*>查看全部 →<\/button>/);
  assert.match(styles, /#recentProjectsMore img\s*\{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
  assert.match(icon, /<svg width="24" height="24"/);
});
