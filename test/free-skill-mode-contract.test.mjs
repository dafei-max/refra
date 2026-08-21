import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [server, app, index, canvas] = await Promise.all([
  readFile(path.join(root, "server.mjs"), "utf-8"),
  readFile(path.join(root, "public", "app.js"), "utf-8"),
  readFile(path.join(root, "public", "index.html"), "utf-8"),
  readFile(path.join(root, "frontend", "canvas.jsx"), "utf-8"),
]);

test("自由模式是默认状态且与技能 UI 隔离", async () => {
  assert.match(index, /id="stylePresetInput"[^>]+value="none"/);
  assert.match(index, /id="briefTopRow" class="brief-top-row hidden"/);
  assert.match(index, /ui-assets\/icon\/skill\.svg/);
  assert.match(index, /id="stylePickerLabel">技能</);
  assert.doesNotMatch(index, /id="styleFolderInput"|id="styleForm"/);
  assert.doesNotMatch(app, /importStyleFolder|style-presets\/add|addStyleFolderButton/);
  assert.match(app, /const skills = allStylePresets\.filter\(\(item\) => item\.id !== "none"\)/);
  assert.match(app, /briefTopRow\?\.classList\.toggle\("hidden", !isPreset\)/);
  assert.match(app, /form\.classList\.toggle\("free-mode", !isPreset\)/);
  assert.match(app, /stylePickerButton\.classList\.toggle\("active", Boolean\(isPreset\)\)/);
  assert.doesNotMatch(await readFile(path.join(root, "public", "styles.css"), "utf-8"), /#005aff/i);
  assert.match(canvas, /ui-assets\/icon\/skill\.svg/);
});

test("自由生成根据图片数量直达 GPT Image 2 且不进入 Skill 链", () => {
  assert.match(server, /if \(request\.style_preset === NO_PRESET_ID\) \{\s*return runFreeGenerationPipeline/);
  assert.match(server, /uploaded\.length === 0[\s\S]*?generateImageFile/);
  assert.match(server, /else \{[\s\S]*?generateImageEditFile\(\{/);
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(server, /final_prompt: prompt/);
  assert.match(server, /text_rewrite: false/);
  assert.match(server, /models: \{ text: null, image: IMAGE_MODEL \}/);
});

test("技能参考图不再把无用途 @ 提及默认为主体", () => {
  assert.doesNotMatch(server, /if \(hasMention\) return "主体"/);
  assert.match(server, /未说明用途时必须标为补充参考|用途不明确时必须标为补充参考/);
  assert.match(server, /classifyUploadedReferencesWithAi\(request\)/);
  assert.match(server, /"产品主体", "人物主体", "字体", "构图", "风格", "补充参考"/);
});

test("只暴露四个内置技能且自定义风格写接口已下线", () => {
  assert.match(server, /name: "3D KV 主视觉设计"/);
  assert.match(server, /name: "扁平 KV 主视觉设计"/);
  assert.doesNotMatch(server, /createCustomStylePreset|deleteCustomStylePreset|hydrateCustomStylePresets/);
  assert.doesNotMatch(server, /POST" && url\.pathname === "\/api\/style-presets\/add/);
});

test("新版 3D 与扁平技能目录和机器可读图库存在", async () => {
  const files = [
    "style/3D风格/skill-3d-kv-main-visual/SKILL.md",
    "style/3D风格/reference-library/3d-clay-character-001.md",
    "style/3D风格/layout-library/vertical-layout-001.md",
    "style/极简扁平插画/skill-flat-kv-main-visual/SKILL.md",
    "style/极简扁平插画/reference-library/flat-clean-vector-whimsy-mixed-001.md",
    "style/极简扁平插画/layout-library/horizontal-layout-001.md",
  ];
  await Promise.all(files.map((file) => access(path.join(root, file))));
  assert.match(server, /skill_dir: "skill-3d-kv-main-visual"/);
  assert.match(server, /skill_dir: "skill-flat-kv-main-visual"/);
  assert.match(server, /skillReferenceRoute/);
});
