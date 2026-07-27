import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(__filename));
const STYLE_DIR = path.join(ROOT, "style");
const ASSET_DIR = path.join(ROOT, "素材资产库图片素材");
const MATERIALS_PATH = path.join(ROOT, "data", "materials.json");
const CUSTOM_STYLES_PATH = path.join(ROOT, "data", "style-presets.json");
const SOURCE = "preset-library";
const NUMBER_PREFIX = "PRESETLIB_";
const DESCRIPTION_LIMIT = 3600;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const ACTIVE_PRESETS = [
  { id: "HANDDRAWN", name: "手绘扁平涂鸦", dir: "手绘扁平涂鸦" },
  { id: "3D", name: "3D风格", dir: "3D风格" },
  { id: "MINIMALFLAT", name: "极简扁平插画", dir: "极简扁平插画" },
  { id: "REALPRODUCT", name: "实景商品", dir: "实景商品" },
];

const GROUP_CONFIG = {
  "整合版式": {
    id: "INTEGRATED",
    type: "整合版式",
    roles: ["字体标题", "构图版式"],
    label: "整合版式",
  },
  "字体": { id: "FONT", type: "字体", roles: ["字体标题"], label: "字体参考" },
  "文字": { id: "FONT", type: "字体", roles: ["字体标题"], label: "文字参考" },
  "排版": { id: "LAYOUT", type: "构图", roles: ["构图版式"], label: "排版参考" },
  "风格": { id: "STYLE", type: "风格", roles: ["风格质感"], label: "风格参考" },
  "元素": { id: "ELEMENT", type: "元素", roles: ["元素主体"], label: "元素参考" },
  "角色": { id: "CHARACTER", type: "角色", roles: ["元素主体"], label: "角色参考" },
};

function safeToken(value, fallback = "REFERENCE") {
  const token = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return token || fallback;
}

function imageFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return imageFiles(file);
    return IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [file] : [];
  });
}

function pairedDescription(imagePath) {
  const base = imagePath.slice(0, -path.extname(imagePath).length);
  const descriptionPath = [".md", ".txt"].map((ext) => `${base}${ext}`).find(existsSync);
  if (!descriptionPath) return "";
  const source = readFileSync(descriptionPath, "utf8").replace(/\r\n/g, "\n").trim();
  const withoutFrontMatter = source.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  if (withoutFrontMatter.length <= DESCRIPTION_LIMIT) return withoutFrontMatter;
  return `${withoutFrontMatter.slice(0, DESCRIPTION_LIMIT).trim()}\n\n（描述已截取，完整规则见风格预设原文件）`;
}

function frontMatter(imagePath) {
  const base = imagePath.slice(0, -path.extname(imagePath).length);
  const descriptionPath = [".md", ".txt"].map((ext) => `${base}${ext}`).find(existsSync);
  if (!descriptionPath) return "";
  return readFileSync(descriptionPath, "utf8").match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || "";
}

function yamlScalar(front, key) {
  const match = front.match(new RegExp(`^${key}:\\s*[\"']?([^\\n\"']+)[\"']?\\s*$`, "m"));
  return match?.[1]?.trim() || "";
}

function yamlList(front, key) {
  const lines = front.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line.trim()));
  if (start < 0) return [];
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s+-\s+[\"']?(.+?)[\"']?\s*$/);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

function imageDimensions(file) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  if (result.status !== 0) return { width: 0, height: 0 };
  return {
    width: Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]) || 0,
    height: Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]) || 0,
  };
}

function orientationTags(front, file, width, height) {
  const rawOrientation = yamlScalar(front, "orientation").toLowerCase();
  const name = path.basename(file).toLowerCase();
  let orientation = "";
  if (rawOrientation.includes("horizontal") || name.includes("horizontal")) orientation = "横版";
  else if (rawOrientation.includes("vertical") || name.includes("vertical")) orientation = "竖版";
  else if (width && height) {
    orientation = width > height * 1.08 ? "横版" : height > width * 1.08 ? "竖版" : "方形";
  }
  return [orientation, ...yamlList(front, "layout_family")].filter(Boolean);
}

function presetMaterial(preset, imagePath) {
  const relative = path.relative(path.join(STYLE_DIR, preset.dir), imagePath);
  const [groupName] = relative.split(path.sep);
  const group = GROUP_CONFIG[groupName];
  if (!group) return null;

  const stem = path.basename(imagePath, path.extname(imagePath));
  const number = `${NUMBER_PREFIX}${preset.id}_${group.id}_${safeToken(stem)}`;
  const extension = path.extname(imagePath).toLowerCase();
  const targetName = `${number}${extension}`;
  const targetPath = path.join(ASSET_DIR, targetName);
  copyFileSync(imagePath, targetPath);

  const front = frontMatter(imagePath);
  const { width, height } = imageDimensions(imagePath);
  const description = pairedDescription(imagePath);
  const referenceDescription = description || `${preset.name}的${group.label}。参考该图的${group.label}特征，不复制其中的具体品牌、文字或无关内容。`;
  const retrievalTags = yamlList(front, "retrieval_tags");

  return {
    number,
    title: `${preset.name} · ${group.label} · ${stem}`,
    type: group.type,
    reference_roles: group.roles,
    image: `/assets/${encodeURIComponent(targetName)}`,
    category: `${preset.name}、${group.label}`,
    reference_description: referenceDescription,
    design_type: preset.name,
    industry_tags: [],
    style_tags: [...new Set([preset.name, group.label, ...retrievalTags])],
    layout_tags: [...new Set(orientationTags(front, imagePath, width, height))],
    source: SOURCE,
    source_id: `${preset.id}:${relative.split(path.sep).join("/")}`,
    source_url: "",
    source_author: "内置风格预设",
    width,
    height,
    created_at: statSync(imagePath).mtime.toISOString(),
  };
}

function customPresetMaterials() {
  if (!existsSync(CUSTOM_STYLES_PATH)) return [];
  const payload = JSON.parse(readFileSync(CUSTOM_STYLES_PATH, "utf8"));
  return (payload.presets || []).flatMap((preset) => {
    const id = safeToken(preset.preset_id || preset.id || preset.name, "CUSTOM");
    const name = preset.name || preset.preset_name || id;
    return (preset.title_variants || []).flatMap((variant, index) => {
      const imageUrl = String(variant.image || "");
      const match = imageUrl.match(/^\/uploads\/styles\/([^/]+)\/(.+)$/);
      if (!match) return [];
      const imagePath = path.join(ROOT, "uploads", "styles", decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      if (!existsSync(imagePath)) return [];
      const number = `${NUMBER_PREFIX}${id}_STYLE_${safeToken(variant.variant_id || index + 1)}`;
      const extension = path.extname(imagePath).toLowerCase() || ".png";
      const targetName = `${number}${extension}`;
      copyFileSync(imagePath, path.join(ASSET_DIR, targetName));
      const { width, height } = imageDimensions(imagePath);
      return [{
        number,
        title: `${name} · 风格参考 · ${index + 1}`,
        type: "风格",
        reference_roles: ["风格质感"],
        image: `/assets/${encodeURIComponent(targetName)}`,
        category: `${name}、风格参考`,
        reference_description: variant.prompt_note
          || (variant.features || []).join("；")
          || `${name}的风格参考图。`,
        design_type: name,
        industry_tags: variant.best_for || [],
        style_tags: [...new Set([name, ...(variant.features || [])])],
        layout_tags: orientationTags("", imagePath, width, height),
        source: SOURCE,
        source_id: `${id}:${variant.variant_id || index + 1}`,
        source_url: "",
        source_author: "自定义风格预设",
        width,
        height,
        created_at: statSync(imagePath).mtime.toISOString(),
      }];
    });
  });
}

function main() {
  const payload = JSON.parse(readFileSync(MATERIALS_PATH, "utf8"));
  const existing = payload.materials || [];
  const retained = existing.filter((item) => item.source !== SOURCE && !String(item.number || "").startsWith(NUMBER_PREFIX));
  const builtIn = ACTIVE_PRESETS.flatMap((preset) => (
    imageFiles(path.join(STYLE_DIR, preset.dir))
      .map((file) => presetMaterial(preset, file))
      .filter(Boolean)
  ));
  const synced = [...builtIn, ...customPresetMaterials()];
  const currentFiles = new Set(synced.map((item) => decodeURIComponent(item.image.replace("/assets/", ""))));

  readdirSync(ASSET_DIR)
    .filter((name) => name.startsWith(NUMBER_PREFIX) && !currentFiles.has(name))
    .forEach((name) => unlinkSync(path.join(ASSET_DIR, name)));

  const materials = [...retained, ...synced];
  writeFileSync(
    MATERIALS_PATH,
    `${JSON.stringify({ source: "dynamic-material-library", count: materials.length, materials }, null, 2)}\n`,
    "utf8",
  );

  const byPreset = Object.fromEntries(
    ACTIVE_PRESETS.map((preset) => [preset.name, synced.filter((item) => item.source_id.startsWith(`${preset.id}:`)).length]),
  );
  console.log(JSON.stringify({
    imported: synced.length,
    retained: retained.length,
    total: materials.length,
    by_preset: byPreset,
  }, null, 2));
}

main();
