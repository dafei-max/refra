import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function sseComplete(response) {
  const text = await response.text();
  const events = text.split("\n\n").map((chunk) => {
    const type = chunk.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
    const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("");
    return data ? { type, data: JSON.parse(data) } : null;
  }).filter(Boolean);
  const error = events.find((event) => event.type === "error");
  if (error) throw new Error(error.data.error);
  return { events, complete: events.findLast((event) => event.type === "complete")?.data };
}

test("完整模拟链路：标题层、初稿、评审和一次优化均可完成", { timeout: 30000 }, async (t) => {
  const calls = { plans: 0, reviews: 0, imageEdits: 0, partialRequests: 0 };
  let reviewMode = "revise";
  let failOptimizationEdit = false;
  const mockOpenAi = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (req.url === "/v1/responses") {
      const body = JSON.parse(raw.toString("utf8"));
      const name = body.text?.format?.name;
      const output = name === "skill_draft_review"
        ? reviewMode === "pass"
          ? {
            needs_revision: false,
            severity: 0.28,
            problem_type: "none",
            max_problem: "",
            evidence: [],
            edit_instructions: [],
            strict_invariants: ["保留标题原文", "保持主体身份"],
          }
          : {
            needs_revision: true,
            severity: 0.82,
            problem_type: "objects_too_complete",
            max_problem: "主体与陪体完整并排，缺少遮挡和穿插",
            evidence: ["两个完整轮廓互不接触"],
            edit_instructions: ["让陪体向左穿插主体轮廓", "用主体遮挡陪体下缘", "缩小陪体间距", "压缩背景纵深"],
            strict_invariants: ["保留标题原文", "保持主体身份"],
          }
        : {
            style_id: "three_d_style_v1",
            generation_prompt: "围绕唯一主体形成遮挡明确的 3D KV",
            evaluation_criteria: ["只有一个主焦点"],
            content_invariants: ["保留用户标题"],
            style_invariants: ["只迁移参考图设计语法"],
          };
      if (name === "skill_draft_review") calls.reviews += 1;
      else calls.plans += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output_text: JSON.stringify(output) }));
      return;
    }
    if (req.url === "/v1/images/edits") {
      calls.imageEdits += 1;
      if (raw.includes(Buffer.from('name="partial_images"'))) calls.partialRequests += 1;
      if (failOptimizationEdit && raw.includes(Buffer.from("Image 1 is the edit target."))) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "simulated optimization failure" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      return;
    }
    res.writeHead(404).end();
  });
  const mockPort = await listen(mockOpenAi);
  t.after(() => close(mockOpenAi));

  const isolatedTmp = await mkdtemp(path.join(tmpdir(), "refra-skill-test-"));
  t.after(() => rm(isolatedTmp, { recursive: true, force: true }));
  const appPort = 24000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    env: {
      ...process.env,
      PORT: String(appPort),
      VERCEL: "1",
      TMPDIR: isolatedTmp,
      STORAGE_BACKEND: "fs",
      ADMIN_TOKEN: "test-token",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      PIPELINE_MODE: "fast",
      RATE_LIMIT_RUN_PER_MIN: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const base = `http://127.0.0.1:${appPort}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await fetch(`${base}/api/health`).then((response) => response.ok).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
  async function runSmartScenario(suffix) {
    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: `Skill Test ${suffix}` }),
    }).then((response) => response.json());
    const run = await fetch(`${base}/api/run-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project_id: created.id,
        campaign_name: `夏日上新 ${suffix}`,
        campaign_subtitle: "清凉一夏",
        campaign_time: "8.21-8.31",
        visual_description: "蓝色饮料瓶作为唯一主体，周围冰块与水花形成穿插",
        image_size: "3:4",
        style_preset: "three_d_style_v1",
        generate_image: true,
        optimization_mode: "smart",
        auto_optimize: true,
      }),
    });
    const first = await sseComplete(run);
    const jobId = first.complete.optimization_job_id;
    const optimize = await fetch(`${base}/api/generation-jobs/${encodeURIComponent(jobId)}/optimize-stream`, {
      method: "POST",
      headers,
      body: "{}",
    });
    return { created, first, optimized: await sseComplete(optimize), jobId };
  }
  const projectResponse = await fetch(`${base}/api/projects`, { method: "POST", headers, body: JSON.stringify({ title: "Skill Test" }) });
  assert.equal(projectResponse.status, 200, stderr);
  const project = await projectResponse.json();
  const runResponse = await fetch(`${base}/api/run-stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      project_id: project.id,
      campaign_name: "夏日上新",
      campaign_subtitle: "清凉一夏",
      campaign_time: "8.21-8.31",
      visual_description: "蓝色饮料瓶作为唯一主体，周围冰块与水花形成穿插",
      image_size: "3:4",
      style_preset: "three_d_style_v1",
      generate_image: true,
      optimization_mode: "smart",
      auto_optimize: true,
    }),
  });
  const initial = await sseComplete(runResponse);
  assert.ok(initial.events.some((event) => event.type === "typography"), stderr);
  assert.ok(initial.events.some((event) => event.type === "draft_ready"), stderr);
  assert.equal(initial.complete.optimization.status, "draft_ready");
  assert.equal(initial.complete.optimization.final_image, null, "初稿阶段不能提前写成最终图");
  const jobId = initial.complete.optimization_job_id;

  const optimizationResponse = await fetch(`${base}/api/generation-jobs/${encodeURIComponent(jobId)}/optimize-stream`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const optimized = await sseComplete(optimizationResponse);
  assert.ok(optimized.events.some((event) => event.type === "optimized_image"), stderr);
  assert.equal(optimized.complete.job.optimization_status, "completed");
  assert.equal(optimized.complete.job.optimization_triggered, true);
  assert.equal(calls.plans, 1);
  assert.equal(calls.reviews, 1);
  assert.equal(calls.imageEdits, 3, "标题版式、完整 KV 初稿、定向优化各调用一次");
  assert.equal(calls.partialRequests, 1, "只有完整 KV 初稿请求 partial_images=1");

  const loadedJob = await fetch(`${base}/api/generation-jobs/${encodeURIComponent(jobId)}`).then((response) => response.json());
  assert.ok(loadedJob.draft_image?.object_key);
  assert.ok(loadedJob.final_image?.object_key);
  assert.notEqual(loadedJob.draft_image.object_key, loadedJob.final_image.object_key);
  for (const key of ["skill_load_ms", "planning_ms", "first_image_ms", "review_ms", "edit_ms", "total_ms"]) {
    assert.equal(Number.isFinite(Number(loadedJob.timing?.[key])), true, `缺少耗时字段 ${key}`);
  }
  t.diagnostic(`模拟链路耗时 ${JSON.stringify(loadedJob.timing)}`);

  const loadedProject = await fetch(`${base}/api/projects/${project.id}`).then((response) => response.json());
  const optimizedElements = loadedProject.elements.filter((element) => element.optimization_job_id === jobId);
  assert.equal(optimizedElements.length, 1, "优化版应更新原画布元素而不是重复新增");
  assert.ok(optimizedElements[0].draft_object_key);
  assert.ok(optimizedElements[0].final_object_key);

  const assets = await fetch(`${base}/api/assets`).then((response) => response.json());
  assert.equal(assets.assets.filter((asset) => asset.optimization_job_id === jobId).length, 1, "初稿和优化版应属于同一生成记录");

  reviewMode = "pass";
  const passEditCount = calls.imageEdits;
  const passed = await runSmartScenario("pass");
  assert.equal(passed.optimized.complete.job.optimization_status, "passed");
  assert.equal(passed.optimized.complete.job.optimization_triggered, false);
  assert.equal(passed.optimized.events.some((event) => event.type === "optimized_image"), false);
  assert.equal(calls.imageEdits - passEditCount, 2, "评审合格时只支付标题层和完整 KV 初稿两次图片费用");

  reviewMode = "revise";
  failOptimizationEdit = true;
  const failed = await runSmartScenario("failure");
  assert.equal(failed.optimized.complete.job.optimization_status, "failed");
  assert.equal(failed.optimized.complete.job.draft_image.object_key, failed.optimized.complete.job.final_image.object_key);
  assert.ok(failed.optimized.events.some((event) => event.type === "optimization_error"));
  const beforeSecondAttempt = calls.imageEdits;
  const repeatedResponse = await fetch(`${base}/api/generation-jobs/${encodeURIComponent(failed.jobId)}/optimize-stream`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const repeated = await sseComplete(repeatedResponse);
  assert.equal(repeated.complete.job.optimization_status, "failed");
  assert.equal(calls.imageEdits, beforeSecondAttempt, "未显式重试时自动优化绝不执行第二次");
});
