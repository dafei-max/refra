import crypto from "node:crypto";

export const GENERATION_JOB_STATUSES = Object.freeze([
  "queued",
  "planning",
  "generating",
  "draft_ready",
  "reviewing",
  "optimizing",
  "completed",
  "failed",
]);

export const SKILL_PLAN_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    style_id: { type: "string" },
    generation_prompt: { type: "string" },
    evaluation_criteria: { type: "array", items: { type: "string" }, maxItems: 10 },
    content_invariants: { type: "array", items: { type: "string" }, maxItems: 12 },
    style_invariants: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
  required: ["style_id", "generation_prompt", "evaluation_criteria", "content_invariants", "style_invariants"],
  additionalProperties: false,
});

export const SKILL_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    needs_revision: { type: "boolean" },
    severity: { type: "number", minimum: 0, maximum: 1 },
    problem_type: { type: "string" },
    max_problem: { type: "string" },
    evidence: { type: "array", items: { type: "string" }, maxItems: 6 },
    edit_instructions: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
    strict_invariants: { type: "array", items: { type: "string" }, maxItems: 16 },
  },
  required: ["needs_revision", "severity", "problem_type", "max_problem", "evidence", "edit_instructions", "strict_invariants"],
  additionalProperties: false,
});

export const SKILL_SELECTION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    selected_output: { type: "string", enum: ["first", "second"] },
    target_problem_fixed: { type: "boolean" },
    regression_detected: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["selected_output", "target_problem_fixed", "regression_detected", "reason"],
  additionalProperties: false,
});

export function normalizeOptimizationMode(value, autoOptimize = true) {
  if (String(value || "").trim().toLowerCase() === "fast" || autoOptimize === false) return "fast";
  return "smart";
}

export function shouldTriggerOptimization(review, threshold = 0.65) {
  return Boolean(
    review?.needs_revision === true
    && Number(review?.severity) >= Number(threshold)
    && String(review?.max_problem || "").trim()
    && Array.isArray(review?.edit_instructions)
    && review.edit_instructions.length,
  );
}

export function authorizedCopyInvariants(request = {}) {
  const fields = [
    ["主标题", request.campaign_name],
    ["副标题", request.campaign_subtitle],
    ["活动时间", request.campaign_time],
  ];
  return fields
    .map(([label, value]) => [label, String(value || "").trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}「${value}」是用户授权且必须保留的固定文案，不得删除、改写、移动或弱化`);
}

export function protectAuthorizedCopyReview(review = {}, request = {}) {
  const allowedCopy = [request.campaign_name, request.campaign_subtitle, request.campaign_time]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!allowedCopy.length || review.needs_revision !== true) return review;

  const reviewText = [
    review.problem_type,
    review.max_problem,
    ...(review.evidence || []),
    ...(review.edit_instructions || []),
  ].filter(Boolean).join("\n");
  const claimsUnauthorizedCopy = (
    /(新增|额外|无来源|未提供|不应出现|违反|禁止)[^\n]{0,40}(标题|副标题|日期|时间|文字|文案|字符)/i.test(reviewText)
    || /(删除|移除|去掉|清空|抹掉)[^\n]{0,30}(标题|副标题|日期|时间|文字|文案|字符)/i.test(reviewText)
    || /unauthori[sz]ed[_ -]?(text|copy)|invented[_ -]?(text|copy)/i.test(reviewText)
  );
  if (!claimsUnauthorizedCopy) return review;

  const quotedCandidates = [...reviewText.matchAll(/[「“"]([^」”"\n]{1,80})[」”"]/g)]
    .map((match) => match[1].trim())
    .filter((value) => value
      && !/(不得|禁止|不新增|新增).*(文字|文案|标题|日期|logo|水印|字符)/i.test(value)
      && (!/(主标题|副标题|标题文字|日期文字|活动时间|可读字符|文案)/.test(value)
        || allowedCopy.some((allowed) => allowed.includes(value) || value.includes(allowed))));
  const hasSpecificUnauthorizedCopy = quotedCandidates.some((candidate) => (
    !allowedCopy.some((allowed) => allowed.includes(candidate) || candidate.includes(allowed))
  ));
  if (hasSpecificUnauthorizedCopy) return review;

  return {
    ...review,
    needs_revision: false,
    severity: 0,
    problem_type: "authorized_copy_protected",
    max_problem: "",
    evidence: [],
    edit_instructions: [],
    review_guard: "授权标题、副标题或活动时间被误判为新增文字，已阻止自动删除",
  };
}

export function buildTargetedEditPrompt(review, invariants = [], { hasTypographyReference = false, hasDesignReference = true } = {}) {
  const instructions = (review?.edit_instructions || []).slice(0, 8).filter(Boolean);
  const strict = [...new Set([...(review?.strict_invariants || []), ...(invariants || [])].filter(Boolean))].slice(0, 18);
  const referenceLines = [
    "Image 1 is the edit target.",
    hasTypographyReference ? "Image 2 is the fixed typography/layout reference. Preserve all authorized copy exactly." : "",
    hasDesignReference
      ? `Image ${hasTypographyReference ? 3 : 2} is the design-language reference only.`
      : "",
  ].filter(Boolean);
  return [
    ...referenceLines,
    "",
    "Fix only this structural problem:",
    String(review?.max_problem || "").trim(),
    "",
    "Targeted changes:",
    ...instructions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Strict invariants:",
    ...strict.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Do not redesign unrelated parts.",
    "Do not add new objects or decorations.",
    "Do not add, remove, rewrite, move or restyle any readable text, logo or brand mark unless the single targeted problem explicitly identifies that exact item as unauthorized.",
  ].join("\n");
}

export function skillVersionFor(content) {
  return crypto.createHash("sha256").update(String(content || "")).digest("hex").slice(0, 16);
}

export function referenceHashFor(bytes) {
  return crypto.createHash("sha256").update(bytes || Buffer.alloc(0)).digest("hex").slice(0, 24);
}

export function styleFingerprintCacheKey(skillVersion, referenceHash) {
  return `${String(skillVersion || "unknown")}:${String(referenceHash || "no-reference")}`;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
  return ordered[index];
}

export function summarizeTimingSamples(samples = []) {
  const fields = ["skill_load_ms", "planning_ms", "first_image_ms", "review_ms", "edit_ms", "total_ms"];
  const result = { sample_count: samples.length, stages: {} };
  for (const field of fields) {
    const values = samples.map((sample) => Number(sample?.[field])).filter(Number.isFinite);
    result.stages[field] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
  }
  return result;
}

export function publicOptimizationJob(job = {}) {
  return {
    id: job.id,
    project_id: job.project_id,
    status: job.status,
    mode: job.mode,
    skill_id: job.skill_id,
    skill_version: job.skill_version,
    draft_image_url: job.draft_image_url || "",
    final_image_url: job.final_image_url || "",
    draft_image: job.draft_image || null,
    final_image: job.final_image || null,
    review_result: job.review_result || null,
    selection_result: job.selection_result || null,
    selected_output: job.selected_output || "",
    optimization_triggered: Boolean(job.optimization_triggered),
    optimization_status: job.optimization_status || "pending",
    optimization_error: job.optimization_error || "",
    timing: job.timing || {},
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}
