const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_PROMPT_LENGTH = 6000;

function text(value, limit = 1000) {
  return value == null ? "" : String(value).trim().slice(0, limit);
}

export function assetObjectKey(value) {
  const raw = text(value, 4096);
  if (!raw || /^(?:data|blob):/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const pathname = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, "");
      return /^(?:outputs|uploads)\//.test(pathname) ? pathname : "";
    } catch {
      return "";
    }
  }
  return raw.replace(/^\/+/, "");
}

function compactJson(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return text(value, 1200);
  if (depth >= 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactJson(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => [key, compactJson(item, depth + 1)]),
    );
  }
  return null;
}

function compactLayer(layer) {
  if (!layer || typeof layer !== "object") return null;
  const objectKey = assetObjectKey(layer.object_key);
  const transparentObjectKey = assetObjectKey(layer.transparent_object_key);
  if (!objectKey && !transparentObjectKey) return null;
  return {
    name: text(layer.name, 240),
    object_key: objectKey,
    transparent_object_key: transparentObjectKey,
  };
}

function compactLayers(layers) {
  if (!layers || typeof layers !== "object") return null;
  const typography = compactLayer(layers.typography);
  const scene = compactLayer(layers.scene);
  return typography || scene ? { typography, scene } : null;
}

function compactSplit(split) {
  if (!split || typeof split !== "object") return null;
  const titleLayer = compactLayer(split.title_layer);
  const backgroundLayer = compactLayer(split.background_layer);
  const splitPackage = compactLayer(split.split_package);
  return titleLayer || backgroundLayer || splitPackage
    ? { title_layer: titleLayer, background_layer: backgroundLayer, split_package: splitPackage }
    : null;
}

export function compactAssetIndexRecord(raw = {}) {
  const objectKey = assetObjectKey(raw.object_key);
  const name = text(raw.name || objectKey.split("/").pop(), 240);
  if (!name && !objectKey) return null;
  return {
    name,
    object_key: objectKey,
    title: text(raw.title, 240),
    subtitle: text(raw.subtitle, 240),
    time: text(raw.time, 240),
    description: text(raw.description, MAX_DESCRIPTION_LENGTH),
    references: [...new Set((Array.isArray(raw.references) ? raw.references : []).map(assetObjectKey).filter(Boolean))].slice(0, 20),
    skill_id: text(raw.skill_id, 160),
    skill_version: text(raw.skill_version, 160),
    generation_prompt: text(raw.generation_prompt, MAX_PROMPT_LENGTH),
    draft_object_key: assetObjectKey(raw.draft_object_key),
    final_object_key: assetObjectKey(raw.final_object_key),
    optimization_job_id: text(raw.optimization_job_id, 180),
    review_result: compactJson(raw.review_result),
    selection_result: compactJson(raw.selection_result),
    selected_output: text(raw.selected_output, 80),
    optimization_triggered: Boolean(raw.optimization_triggered),
    optimization_status: text(raw.optimization_status, 80),
    optimization_error: text(raw.optimization_error, 1000),
    timing: compactJson(raw.timing),
    generation_mode: text(raw.generation_mode, 120),
    layers: compactLayers(raw.layers),
    split: compactSplit(raw.split),
    created_at: text(raw.created_at, 80),
    modified_at: text(raw.modified_at, 80),
  };
}

export function compactAssetIndex(records = []) {
  return records.map(compactAssetIndexRecord).filter(Boolean);
}
