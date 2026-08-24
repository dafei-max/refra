import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SKILL_PLAN_SCHEMA,
  SKILL_REVIEW_SCHEMA,
  buildTargetedEditPrompt,
  normalizeOptimizationMode,
  shouldTriggerOptimization,
  skillVersionFor,
  styleFingerprintCacheKey,
  summarizeTimingSamples,
} from "../services/skill-optimization.mjs";

test("smart mode only triggers one edit for a concrete review above threshold", () => {
  const review = {
    needs_revision: true,
    severity: 0.8,
    max_problem: "多个商品完整并排，缺少遮挡关系",
    edit_instructions: ["让陪体遮挡主体底部"],
  };
  assert.equal(normalizeOptimizationMode("smart", true), "smart");
  assert.equal(shouldTriggerOptimization(review, 0.65), true);
  assert.equal(shouldTriggerOptimization({ ...review, severity: 0.64 }, 0.65), false);
  assert.equal(shouldTriggerOptimization({ ...review, needs_revision: false }, 0.65), false);
});

test("targeted edit prompt fixes one problem and preserves input order semantics", () => {
  const prompt = buildTargetedEditPrompt({
    max_problem: "主体与陪体互不接触",
    edit_instructions: ["让右侧陪体向左穿插主体轮廓", "用主体前景遮挡陪体下缘"],
    strict_invariants: ["保留主标题原文", "保持商品包装身份"],
  });
  assert.match(prompt, /^Image 1 is the edit target\./);
  assert.match(prompt, /Image 2 is the design-language reference only\./);
  assert.match(prompt, /Fix only this structural problem:\n主体与陪体互不接触/);
  assert.match(prompt, /Do not redesign unrelated parts\./);
  assert.match(prompt, /Do not add new objects, text, logos or decorations\./);
});

test("skill/reference cache key is stable and timing summary reports p50/p95", () => {
  const version = skillVersionFor("same complete skill");
  assert.equal(version, skillVersionFor("same complete skill"));
  assert.equal(styleFingerprintCacheKey(version, "abc"), `${version}:abc`);
  const summary = summarizeTimingSamples([
    { planning_ms: 100, total_ms: 1000 },
    { planning_ms: 200, total_ms: 2000 },
    { planning_ms: 900, total_ms: 9000 },
  ]);
  assert.equal(summary.stages.planning_ms.p50, 200);
  assert.equal(summary.stages.planning_ms.p95, 900);
});

test("structured schemas require every requested planning and review field", () => {
  assert.deepEqual(SKILL_PLAN_SCHEMA.required, [
    "style_id", "generation_prompt", "evaluation_criteria", "content_invariants", "style_invariants",
  ]);
  assert.deepEqual(SKILL_REVIEW_SCHEMA.required, [
    "needs_revision", "severity", "problem_type", "max_problem", "evidence", "edit_instructions", "strict_invariants",
  ]);
  assert.equal(SKILL_PLAN_SCHEMA.additionalProperties, false);
  assert.equal(SKILL_REVIEW_SCHEMA.additionalProperties, false);
});

test("server contract uses reference edit for draft, correct second-round order, and one attempt", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /planSkillGeneration\(\{[\s\S]*?skill:\s*skillRuntime[\s\S]*?references:\s*promptReferences/);
  assert.match(server, /generateLayeredImage\([\s\S]*?quality:\s*"low"[\s\S]*?partialImages:\s*1/);
  assert.match(server, /selected:\s*\[draftReference, styleReference\]\.filter\(Boolean\)[\s\S]*?quality:\s*"medium"/);
  assert.match(server, /optimization_attempts:\s*1/);
  assert.match(server, /optimization_status:\s*"failed"[\s\S]*?final_image:\s*job\.draft_image/);
  assert.doesNotMatch(server, /while\s*\([\s\S]{0,300}optimization/);
});

test("canvas contract exposes draft immediately, then optimized version and retry", async () => {
  const canvas = await readFile(new URL("../frontend/canvas.jsx", import.meta.url), "utf8");
  assert.match(canvas, /event === "image_preview"/);
  assert.match(canvas, /event === "optimized_image"/);
  assert.match(canvas, /查看初稿/);
  assert.match(canvas, /查看优化版/);
  assert.match(canvas, /重新优化/);
  assert.match(canvas, /void runOptimization/);
  assert.match(canvas, /ui-assets\/icon\/image\.svg/);
  assert.doesNotMatch(canvas, /className="cf-node-version-bar"/);
  assert.doesNotMatch(canvas, /className="cf-node-optimization-reason"/);
  assert.match(canvas, /className="cf-msg-optimization-reason"/);
});
