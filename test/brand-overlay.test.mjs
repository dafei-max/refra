import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { applyBrandOverlays } from "../services/brand-overlay.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("brand overlays are composited in Node without a Python runtime", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "refra-brand-overlay-"));
  const output = path.join(workDir, "source.png");
  try {
    await sharp({
      create: { width: 900, height: 700, channels: 3, background: "#f4f4f4" },
    }).png().toFile(output);
    const before = await readFile(output);
    const result = await applyBrandOverlays(output, {
      includeLogo: true,
      includeSearch: true,
      darkLogoPath: path.join(root, "image", "Group.png"),
      lightLogoPath: path.join(root, "image", "Group 2147242265.png"),
      logoLeft: 40,
      logoTop: 40,
      logoWidth: 200,
      searchLightPath: path.join(root, "image", "search_light.png"),
      searchDarkPath: path.join(root, "image", "search_dark.png"),
      searchWidth: 295,
      searchRight: 44,
      searchBottom: 22,
      campaignName: "测试活动",
      fontPath: path.join(root, "font", "DouyinSansBold.otf"),
    });
    const after = await readFile(output);
    const metadata = await sharp(after).metadata();
    assert.notDeepEqual(after, before);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 900);
    assert.equal(metadata.height, 700);
    assert.equal(result.logo?.name, "Group 2147242265.png");
    assert.equal(result.search?.name, "search_light.png");
    assert.ok(result.logo.luminance >= 150);
    assert.ok(result.search.luminance >= 150);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("production bundle includes the font and server no longer spawns apply_logo.py", async () => {
  const [server, service, vercel] = await Promise.all([
    readFile(path.join(root, "server.mjs"), "utf-8"),
    readFile(path.join(root, "services", "brand-overlay.mjs"), "utf-8"),
    readFile(path.join(root, "vercel.json"), "utf-8"),
  ]);
  assert.match(server, /import \{ applyBrandOverlays \}/);
  assert.doesNotMatch(server, /apply_logo\.py/);
  assert.doesNotMatch(server, /codex-runtimes/);
  assert.match(server, /brand_overlay_engine: "sharp"/);
  assert.match(server, /brand_overlay_loading: "lazy"/);
  assert.match(server, /brand_overlay_python_required: false/);
  assert.doesNotMatch(service, /^import sharp/m);
  assert.match(service, /import\("sharp"\)/);
  assert.match(vercel, /font\/\*\*/);
});
