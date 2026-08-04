import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ImageSourceError,
  MAX_IMAGE_BYTES,
  resolveImageBytes,
  resolveLocalSource,
  __testing,
} from "../services/image-source-resolver.mjs";

// 1x1 transparent PNG used as fixture bytes.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_MIME = "image/png";

function makeRoots(root) {
  return {
    style: path.join(root, "style"),
    image: path.join(root, "image"),
    doudou: path.join(root, "doudou"),
    assets: path.join(root, "assets"),
    uploads: [path.join(root, "runtime", "uploads"), path.join(root, "uploads")],
    outputs: path.join(root, "outputs"),
  };
}

function setupFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "refra-resolver-"));
  const chineseWithSpace = path.join(root, "style", "测试 目录", "整合版式");
  const realPerson = path.join(root, "style", "真实人物", "整合版式");
  const packagedUploads = path.join(root, "uploads", "materials");
  const runtimeUploads = path.join(root, "runtime", "uploads", "materials");
  const outputs = path.join(root, "outputs");
  for (const dir of [chineseWithSpace, realPerson, packagedUploads, runtimeUploads, outputs]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(chineseWithSpace, "Product_Vertical14.png"), PNG_BYTES);
  writeFileSync(path.join(realPerson, "Product_Vertical14.png"), PNG_BYTES);
  writeFileSync(path.join(packagedUploads, "packaged-only.png"), PNG_BYTES);
  writeFileSync(path.join(runtimeUploads, "runtime-only.png"), PNG_BYTES);
  writeFileSync(path.join(outputs, "stage-one.png"), PNG_BYTES);
  writeFileSync(path.join(root, "style", "note.txt"), "not an image");
  writeFileSync(path.join(root, "secret.png"), PNG_BYTES);
  writeFileSync(path.join(root, "style", "huge.png"), Buffer.alloc(2048, 1));
  return { root, roots: makeRoots(root) };
}

test("本地 /style/ 中文与空格编码路径", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const source = "/style/%E6%B5%8B%E8%AF%95%20%E7%9B%AE%E5%BD%95/%E6%95%B4%E5%90%88%E7%89%88%E5%BC%8F/Product_Vertical14.png";
  const result = await resolveImageBytes(source, { roots });
  assert.equal(result.kind, "local");
  assert.equal(result.sourceType, "style");
  assert.equal(result.type, PNG_MIME);
  assert.deepEqual(result.bytes, PNG_BYTES);
  assert.equal(result.safePath, source);
});

test("本地 /style/ 原始中文路径", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const source = "/style/真实人物/整合版式/Product_Vertical14.png";
  const result = await resolveImageBytes(source, { roots });
  assert.equal(result.kind, "local");
  assert.equal(result.type, PNG_MIME);
  assert.deepEqual(result.bytes, PNG_BYTES);
});

test("历史拼写 /sytle/ 兼容映射", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const source = "/sytle/真实人物/整合版式/Product_Vertical14.png";
  const result = await resolveImageBytes(source, { roots });
  assert.equal(result.kind, "local");
  assert.equal(result.type, PNG_MIME);
});

test("/uploads/ 优先运行时根，缺失时回退打包根", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const runtimeOnly = await resolveImageBytes("/uploads/materials/runtime-only.png", { roots });
  assert.deepEqual(runtimeOnly.bytes, PNG_BYTES);
  assert.equal(runtimeOnly.safePath, "/uploads/materials/runtime-only.png");

  const packagedOnly = await resolveImageBytes("/uploads/materials/packaged-only.png", { roots });
  assert.deepEqual(packagedOnly.bytes, PNG_BYTES);
});

test("/outputs/ 运行时资源", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await resolveImageBytes("/outputs/stage-one.png", { roots });
  assert.equal(result.kind, "local");
  assert.equal(result.type, PNG_MIME);
});

test("绝对路径仅在允许目录内", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const inside = await resolveImageBytes(path.join(root, "outputs", "stage-one.png"), { roots });
  assert.deepEqual(inside.bytes, PNG_BYTES);

  await assert.rejects(
    () => resolveImageBytes(path.join(root, "secret.png"), { roots }),
    (error) => error instanceof ImageSourceError && /不在允许目录内/.test(error.message),
  );
  await assert.rejects(
    () => resolveImageBytes("/etc/passwd", { roots }),
    (error) => error instanceof ImageSourceError,
  );
});

test("拒绝路径穿越", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const attempts = [
    "/style/../secret.png",
    "/style/%2e%2e/%2e%2e/secret.png",
    "/style/%2Fetc%2Fpasswd",
    "/style/..%2F..%2Fsecret.png",
  ];
  for (const source of attempts) {
    await assert.rejects(
      () => resolveImageBytes(source, { roots }),
      (error) => error instanceof ImageSourceError && /路径穿越/.test(error.message),
      `应当拒绝: ${source}`,
    );
  }
  assert.throws(() => resolveLocalSource("/style/../secret.png", roots), ImageSourceError);
});

test("data: URL 解码与非法类型拒绝", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const dataUrl = `data:${PNG_MIME};base64,${PNG_BYTES.toString("base64")}`;
  const result = await resolveImageBytes(dataUrl, { roots });
  assert.equal(result.kind, "data");
  assert.equal(result.type, PNG_MIME);
  assert.deepEqual(result.bytes, PNG_BYTES);

  await assert.rejects(
    () => resolveImageBytes("data:text/plain;base64,aGVsbG8=", { roots }),
    (error) => error instanceof ImageSourceError && /MIME/.test(error.message),
  );
  await assert.rejects(
    () => resolveImageBytes(`data:${PNG_MIME};base64,${"A".repeat(30_000_000)}`, { roots }),
    (error) => error instanceof ImageSourceError && /大小限制/.test(error.message),
  );
});

test("http(s) URL 下载与校验", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const server = createServer((req, res) => {
    if (req.url === "/ok.png") {
      res.writeHead(200, { "Content-Type": PNG_MIME, "Content-Length": PNG_BYTES.length });
      res.end(PNG_BYTES);
    } else if (req.url === "/wrong-mime.png") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PNG_BYTES);
    } else if (req.url === "/not-image") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not an image</html>");
    } else if (req.url === "/huge.png") {
      res.writeHead(200, { "Content-Type": PNG_MIME, "Content-Length": 4096 });
      res.end(Buffer.alloc(4096, 1));
    } else {
      res.writeHead(404);
      res.end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${port}`;

  const ok = await resolveImageBytes(`${baseUrl}/ok.png`, { roots });
  assert.equal(ok.kind, "remote");
  assert.equal(ok.type, PNG_MIME);
  assert.deepEqual(ok.bytes, PNG_BYTES);

  // Sniffed bytes win over a wrong declared content-type.
  const wrongMime = await resolveImageBytes(`${baseUrl}/wrong-mime.png`, { roots });
  assert.equal(wrongMime.type, PNG_MIME);

  await assert.rejects(
    () => resolveImageBytes(`${baseUrl}/not-image`, { roots }),
    (error) => error instanceof ImageSourceError && /图片格式/.test(error.message),
  );
  await assert.rejects(
    () => resolveImageBytes(`${baseUrl}/huge.png`, { roots, maxBytes: 1024 }),
    (error) => error instanceof ImageSourceError && /大小限制/.test(error.message),
  );
  await assert.rejects(
    () => resolveImageBytes(`${baseUrl}/missing.png`, { roots }),
    (error) => error instanceof ImageSourceError && /HTTP 404/.test(error.message),
  );
});

test("本地文件缺失时回退到同部署绝对 URL（Vercel 场景）", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Simulate a deployment whose static files are served by the edge but are
  // missing from the function bundle: the bundle root has no style/ files.
  const bareRoots = { ...roots, style: path.join(root, "style-missing") };

  const server = createServer((req, res) => {
    if (req.url === "/style/%E7%9C%9F%E5%AE%9E%E4%BA%BA%E7%89%A9/%E6%95%B4%E5%90%88%E7%89%88%E5%BC%8F/Product_Vertical14.png") {
      res.writeHead(200, { "Content-Type": PNG_MIME });
      res.end(PNG_BYTES);
      return;
    }
    res.writeHead(404);
    res.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(() => server.close());
  const deploymentBaseUrl = `http://127.0.0.1:${port}`;

  const source = "/style/真实人物/整合版式/Product_Vertical14.png";
  const result = await resolveImageBytes(source, {
    roots: bareRoots,
    deploymentBaseUrl,
  });
  assert.equal(result.kind, "remote");
  assert.equal(result.sourceType, "style");
  assert.equal(result.type, PNG_MIME);
  assert.deepEqual(result.bytes, PNG_BYTES);
  assert.equal(result.safePath, source);

  // Without a deployment base, the missing local file is a clear error.
  const missing = await resolveImageBytes(source, { roots: bareRoots }).catch((error) => error);
  assert.ok(missing instanceof ImageSourceError);
  assert.match(missing.message, /文件不存在（目录=style）/);
});

test("部署回退 URL 只允许同源且校验来源", (t) => {
  const build = __testing.buildDeploymentUrl;
  const same = build("/style/a.png", "https://refra.example.com");
  assert.equal(same.href, "https://refra.example.com/style/a.png");
  assert.equal(build("//evil.example.com/style/a.png", "https://refra.example.com"), null);
  assert.equal(build("https://evil.example.com/style/a.png", "https://refra.example.com"), null);
  assert.equal(build("/style/a.png", "javascript:alert(1)"), null);
  assert.equal(build("/style/a.png", ""), null);
});

test("本地文件缺失、非图片、超限均给出安全错误", async (t) => {
  const { root, roots } = setupFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const missing = await resolveImageBytes("/style/不存在.png", { roots }).catch((error) => error);
  assert.ok(missing instanceof ImageSourceError);
  assert.match(missing.message, /本地文件/);
  assert.match(missing.message, /\/style\/不存在\.png/);
  assert.match(missing.message, /文件不存在/);

  const notImage = await resolveImageBytes("/style/note.txt", { roots }).catch((error) => error);
  assert.ok(notImage instanceof ImageSourceError);
  assert.match(notImage.message, /图片格式/);

  const huge = await resolveImageBytes("/style/huge.png", { roots, maxBytes: 1024 }).catch((error) => error);
  assert.ok(huge instanceof ImageSourceError);
  assert.match(huge.message, /大小限制/);

  const unknown = await resolveImageBytes("relative/path.png", { roots }).catch((error) => error);
  assert.ok(unknown instanceof ImageSourceError);
  assert.match(unknown.message, /未知来源/);
});

test("错误信息不泄露 data URL 载荷", async (t) => {
  const secret = "SUPER_SECRET_PAYLOAD_CONTENT";
  const source = `data:${PNG_MIME};base64,${Buffer.from(secret).toString("base64")}`;
  const error = await resolveImageBytes(source, {}).catch((err) => err);
  assert.ok(error instanceof ImageSourceError);
  assert.equal(error.message.includes(secret), false);
});

test("最大图片字节数常量可用", () => {
  assert.equal(MAX_IMAGE_BYTES, 20 * 1024 * 1024);
});
