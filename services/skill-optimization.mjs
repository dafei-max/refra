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

export function buildTargetedEditPrompt(review, invariants = []) {
  const instructions = (review?.edit_instructions || []).slice(0, 8).filter(Boolean);
  const strict = [...new Set([...(review?.strict_invariants || []), ...(invariants || [])].filter(Boolean))].slice(0, 18);
  return [
    "Image 1 is the edit target.",
    "Image 2 is the design-language reference only.",
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
    "Do not add new objects, text, logos or decorations.",
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
    optimization_triggered: Boolean(job.optimization_triggered),
    optimization_status: job.optimization_status || "pending",
    optimization_error: job.optimization_error || "",
    timing: job.timing || {},
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}
