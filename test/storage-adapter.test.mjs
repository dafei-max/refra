import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  StorageError,
  initStorage,
  storageBackend,
  storageDelete,
  storageExists,
  storageGet,
  storagePut,
  storageSignUrl,
  __storageTesting,
} from "../services/storage-adapter.mjs";

test("本地 filesystem 适配器：写入/读取/删除/签名", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "refra-storage-"));
  t.after(() => initStorage({ env: { STORAGE_BACKEND: "fs" }, runtimeRoot: root }));

  initStorage({ env: { STORAGE_BACKEND: "fs" }, runtimeRoot: root });
  assert.equal(storageBackend(), "fs");

  const key = "outputs/kv-test-1.png";
  const bytes = Buffer.from([1, 2, 3, 4]);
  await storagePut(key, bytes, { contentType: "image/png" });
  assert.equal(await storageExists(key), true);
  assert.deepEqual(await storageGet(key), bytes);
  assert.equal(readFileSync(path.join(root, key)).length, 4);

  const url = storageSignUrl(key);
  assert.equal(url, "/outputs/kv-test-1.png");

  assert.equal(storageSignUrl("uploads/materials/a.png"), "/uploads/materials/a.png");
  assert.equal(storageSignUrl("data/assets.json"), "");

  assert.equal(await storageDelete(key), true);
  assert.equal(await storageExists(key), false);
});

test("OSS 模式缺少配置时给出明确错误", () => {
  assert.throws(
    () => initStorage({ env: { STORAGE_BACKEND: "oss" }, isVercel: true, runtimeRoot: tmpdir() }),
    (error) => error instanceof StorageError && /ALIYUN_OSS_REGION/.test(error.message),
  );
  assert.throws(
    () => initStorage({
      env: { STORAGE_BACKEND: "oss", ALIYUN_OSS_REGION: "oss-cn-shanghai", ALIYUN_OSS_BUCKET: "refra-assets" },
      isVercel: true,
      runtimeRoot: tmpdir(),
    }),
    (error) => error instanceof StorageError && /ALIYUN_OSS_ACCESS_KEY_ID/.test(error.message),
  );
});

test("非法的存储 key 被拒绝", () => {
  const { normalizeKey } = __storageTesting;
  assert.equal(normalizeKey("outputs/a.png"), "outputs/a.png");
  assert.equal(normalizeKey("/outputs/a.png"), "outputs/a.png");
  assert.throws(() => normalizeKey("../etc/passwd"), StorageError);
  assert.throws(() => normalizeKey("outputs/../a.png"), StorageError);
  assert.throws(() => normalizeKey(""), StorageError);
});

test("OSS 默认启用有界的超时重试", () => {
  assert.equal(__storageTesting.DEFAULT_OSS_REQUEST_TIMEOUT_MS, 5000);
  assert.equal(__storageTesting.DEFAULT_OSS_RETRY_MAX, 2);
});

test("OSS 失败日志只记录安全诊断字段", () => {
  const entry = __storageTesting.storageFailureLogEntry(
    "get",
    "data/projects.json",
    {
      code: "ETIMEDOUT",
      message: "connect timed out https://example.invalid/?AccessKeySecret=do-not-log",
      requestId: "oss-request-safe-id",
    },
  );
  assert.equal(entry.event, "oss_operation_failed");
  assert.equal(entry.operation, "get");
  assert.equal(entry.key_scope, "data");
  assert.equal(entry.failure_type, "timeout");
  assert.equal(entry.oss_request_id, "oss-request-safe-id");
  assert.match(entry.key_hash, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(entry), /projects\.json|AccessKeySecret|do-not-log|example\.invalid/);
});

test("OSS 服务端读写走传输加速，浏览器签名链接保留区域端点", (t) => {
  t.after(() => initStorage({ env: { STORAGE_BACKEND: "fs" }, runtimeRoot: tmpdir() }));

  initStorage({
    env: {
      STORAGE_BACKEND: "oss",
      ALIYUN_OSS_REGION: "oss-cn-shanghai",
      ALIYUN_OSS_BUCKET: "refra-assets",
      ALIYUN_OSS_ACCESS_KEY_ID: "test-access-key-id",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "test-access-key-secret",
    },
    isVercel: true,
    runtimeRoot: tmpdir(),
  });

  assert.equal(
    __storageTesting.operationEndpointHostname(),
    __storageTesting.DEFAULT_OSS_ACCELERATE_ENDPOINT,
  );
  assert.equal(__storageTesting.signingEndpointHostname(), "oss-cn-shanghai.aliyuncs.com");

  const signedUrl = storageSignUrl("outputs/kv-test.png");
  assert.match(signedUrl, /^https:\/\/refra-assets\.oss-cn-shanghai\.aliyuncs\.com\//);
  assert.doesNotMatch(signedUrl, /oss-accelerate/);
});
