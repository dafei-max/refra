import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  buildRightApiImageRequest,
  generateRightApiImage,
} from "../services/rightapi-image-provider.mjs";

test("RightAPI 绘图请求固定异步并保持参考图顺序", () => {
  const body = buildRightApiImageRequest({
    model: "gpt-image-2",
    prompt: "保持 Image 1 人物身份，参考 Image 2 构图",
    size: "960x1280",
    images: [
      { type: "image/jpeg", bytes: Buffer.from("person") },
      { type: "image/png", bytes: Buffer.from("layout") },
    ],
  });
  assert.equal(body.async, true);
  assert.equal(body.n, 1);
  assert.equal(body.imageSize, undefined);
  assert.equal(body.size, "960x1280");
  assert.match(body.image[0], /^data:image\/jpeg;base64,/);
  assert.match(body.image[1], /^data:image\/png;base64,/);
  assert.equal(buildRightApiImageRequest({ model: "gpt-image-2-vip", prompt: "生成图片" }).imageSize, "1K");
});

test("RightAPI 提交任务后轮询并读取 Images 结果", async () => {
  const calls = [];
  const payloads = [
    { task_id: "task_1", status: "processing" },
    { task_id: "task_1", status: "in_progress", progress: 50 },
    { data: [{ b64_json: Buffer.from("result").toString("base64") }] },
  ];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payloads.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await generateRightApiImage({
    apiKey: "test-key",
    prompt: "生成图片",
    fetchImpl,
    sleepImpl: async () => {},
    pollIntervalMs: 1,
  });
  assert.equal(Buffer.from(result.b64, "base64").toString(), "result");
  assert.equal(result.taskId, "task_1");
  assert.match(calls[0].url, /\/draw\/v1\/images\/generations$/);
  assert.match(calls[1].url, /\/v1\/tasks\/task_1$/);
  assert.equal(JSON.parse(calls[0].init.body).async, true);
});

test("RightAPI URL 结果会立即下载为可持久化 base64", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("images/generations")) {
      return new Response(JSON.stringify({ task_id: "task_url" }), { status: 200 });
    }
    if (String(url).includes("/tasks/")) {
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/result.png" }] }), { status: 200 });
    }
    return new Response(Buffer.from("png-bytes"), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  const result = await generateRightApiImage({
    apiKey: "test-key",
    prompt: "生成图片",
    fetchImpl,
    sleepImpl: async () => {},
    pollIntervalMs: 1,
  });
  assert.equal(Buffer.from(result.b64, "base64").toString(), "png-bytes");
});

test("RightAPI 失败任务返回上游安全错误", async () => {
  const payloads = [
    { task_id: "task_failed" },
    { status: "failed", error: { message: "上游生成失败" } },
  ];
  await assert.rejects(() => generateRightApiImage({
    apiKey: "test-key",
    prompt: "生成图片",
    fetchImpl: async () => new Response(JSON.stringify(payloads.shift()), { status: 200 }),
    sleepImpl: async () => {},
    pollIntervalMs: 1,
  }), /上游生成失败/);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("Refra 自由模式可完整切换到 RightAPI 文本规划与异步绘图", { timeout: 30_000 }, async (t) => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==";
  const calls = { planning: 0, drawing: 0, polling: 0 };
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/codex/v1/responses") {
      calls.planning += 1;
      const body = JSON.parse(raw);
      assert.equal(body.model, "gpt-5.5");
      assert.equal(body.tools, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "resp_rightapi", output_text: "真实自然光摄影，一只白色陶瓷咖啡杯置于木桌" }));
      return;
    }
    if (req.url === "/draw/v1/images/generations") {
      calls.drawing += 1;
      const body = JSON.parse(raw);
      assert.equal(body.async, true);
      assert.equal(body.n, 1);
      assert.equal(body.model, "gpt-image-2");
      assert.match(body.prompt, /真实自然光摄影/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ task_id: "task_free" }));
      return;
    }
    if (req.url === "/v1/tasks/task_free") {
      calls.polling += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png }] }));
      return;
    }
    res.writeHead(404).end();
  });
  const mockPort = await listen(mock);
  t.after(() => close(mock));

  const isolatedTmp = await mkdtemp(path.join(tmpdir(), "refra-rightapi-test-"));
  t.after(() => rm(isolatedTmp, { recursive: true, force: true }));
  const appPort = 26000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    env: {
      ...process.env,
      PORT: String(appPort),
      VERCEL: "1",
      TMPDIR: isolatedTmp,
      STORAGE_BACKEND: "fs",
      ADMIN_TOKEN: "test-token",
      AI_PROVIDER: "rightapi",
      RIGHTAPI_API_KEY: "test-key",
      RIGHTAPI_TEXT_BASE_URL: `http://127.0.0.1:${mockPort}/codex/v1`,
      RIGHTAPI_IMAGE_BASE_URL: `http://127.0.0.1:${mockPort}/draw/v1`,
      RIGHTAPI_TASK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      RIGHTAPI_POLL_INTERVAL_MS: "500",
      RATE_LIMIT_RUN_PER_MIN: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const base = `http://127.0.0.1:${appPort}`;
  let health;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    health = await fetch(`${base}/api/health`).then((response) => response.ok ? response.json() : null).catch(() => null);
    if (health) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(health?.api_provider, "rightapi", stderr);
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
  const project = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "RightAPI Test" }),
  }).then((response) => response.json());
  const response = await fetch(`${base}/api/run-stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      project_id: project.id,
      visual_description: "生成真实自然光下的白色陶瓷咖啡杯",
      image_size: "1:1",
      style_preset: "none",
      generate_image: true,
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, stderr);
  assert.match(body, /event: complete/);
  assert.doesNotMatch(body, /event: error/);
  assert.deepEqual(calls, { planning: 1, drawing: 1, polling: 1 });
});
