import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("项目索引只在确认不存在时迁移并可回退到进程缓存", async () => {
  const server = await readFile(path.join(root, "server.mjs"), "utf-8");
  assert.match(server, /error instanceof StorageError && error\.code === "NOT_FOUND"/);
  assert.match(server, /if \(projectsIndexCache\) return cloneProjectsIndex\(projectsIndexCache\)/);
  assert.match(server, /projectsIndexCache = cloneProjectsIndex\(projects\)/);
  assert.ok((server.match(/if \(error\.code !== "NOT_FOUND"\) throw error/g) || []).length >= 2);
});

test("生产函数部署在靠近上海 OSS 的香港区域", async () => {
  const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf-8"));
  assert.deepEqual(config.services.web.functions["server.mjs"].regions, ["hkg1"]);
});

test("生产 OSS 操作使用传输加速且签名 URL 保留区域端点", async () => {
  const storage = await readFile(path.join(root, "services", "storage-adapter.mjs"), "utf-8");
  assert.match(storage, /DEFAULT_OSS_ACCELERATE_ENDPOINT = "oss-accelerate\.aliyuncs\.com"/);
  assert.match(storage, /ossClient = new OSS\(\{[\s\S]*endpoint:[\s\S]*DEFAULT_OSS_ACCELERATE_ENDPOINT/);
  assert.match(storage, /ossSigningClient = new OSS\(sharedOptions\)/);
  assert.match(storage, /return ossSigningClient\.signatureUrl/);
});

test("首页项目失败可重试且创建项目不会产生未处理异常", async () => {
  const app = await readFile(path.join(root, "public", "app.js"), "utf-8");
  assert.match(app, /项目加载失败，点击重试/);
  assert.match(app, /form\.addEventListener\("submit", async \(event\) => \{[\s\S]*setLoading\(true\);[\s\S]*catch \(error\) \{[\s\S]*setError\(/);
});
