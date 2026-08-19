import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import { applyBrandOverlays } from "../services/brand-overlay.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PNG } = pngjs;

test("brand overlays are composited in Node without a Python runtime", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "refra-brand-overlay-"));
  const output = path.join(workDir, "source.png");
  try {
    const source = new PNG({ width: 900, height: 700 });
    for (let offset = 0; offset < source.data.length; offset += 4) {
      source.data[offset] = 244;
      source.data[offset + 1] = 244;
      source.data[offset + 2] = 244;
      source.data[offset + 3] = 255;
    }
    await writeFile(output, PNG.sync.write(source));
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
      campaignName: "夏日新品首发",
      fontPath: path.join(root, "font", "DouyinSansBold.otf"),
    });
    const after = await readFile(output);
    const rendered = PNG.sync.read(after);
    assert.notDeepEqual(after, before);
    assert.equal(rendered.width, 900);
    assert.equal(rendered.height, 700);
    assert.equal(result.logo?.name, "Group 2147242265.png");
    assert.equal(result.search?.name, "search_light.png");
    assert.ok(result.logo.luminance >= 150);
    assert.ok(result.search.luminance >= 150);
    assert.equal(result.search.title, "夏日新品首发");
    assert.ok(result.search.titleFontSize > 0);
    let titlePixels = 0;
    const titleLeft = result.search.left + Math.round(result.search.width * 0.335);
    const titleRight = result.search.left + Math.round(result.search.width * 0.916);
    const titleTop = result.search.top + Math.round(result.search.height * 0.642);
    const titleBottom = result.search.top + Math.round(result.search.height * 0.946);
    for (let y = titleTop; y < titleBottom; y += 1) {
      for (let x = titleLeft; x < titleRight; x += 1) {
        const offset = (y * rendered.width + x) * 4;
        if (rendered.data[offset] < 80 && rendered.data[offset + 1] < 80 && rendered.data[offset + 2] < 80) {
          titlePixels += 1;
        }
      }
    }
    assert.ok(titlePixels > 100, `expected rendered title pixels, received ${titlePixels}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("production bundle uses the lazy serverless overlay engine", async () => {
  const [server, service, vercel] = await Promise.all([
    readFile(path.join(root, "server.mjs"), "utf-8"),
    readFile(path.join(root, "services", "brand-overlay.mjs"), "utf-8"),
    readFile(path.join(root, "vercel.json"), "utf-8"),
  ]);
  assert.match(server, /import \{ applyBrandOverlays \}/);
  assert.doesNotMatch(server, /apply_logo\.py/);
  assert.doesNotMatch(server, /codex-runtimes/);
  assert.match(server, /brand_overlay_engine: "pngjs\+resvg-wasm"/);
  assert.match(server, /brand_overlay_loading: "lazy"/);
  assert.match(server, /brand_overlay_python_required: false/);
  assert.doesNotMatch(service, /sharp/);
  assert.match(service, /import\("pngjs"\)/);
  assert.match(service, /import\("@resvg\/resvg-wasm"\)/);
  assert.doesNotMatch(service, /pureimage/);
  assert.match(vercel, /font\/\*\*/);
  assert.match(vercel, /@resvg\/resvg-wasm\/index_bg\.wasm/);
  assert.match(server, /url\.pathname === "\/api\/health\/brand-overlay"/);
  assert.match(server, /collectAssetKeys\(asset\)\.includes\(element\.object_key\)/);
  assert.match(server, /sourceAsset\?\.title/);
});
