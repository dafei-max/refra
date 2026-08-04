import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";

// Unified storage adapter.
//
// Local development writes to the repository filesystem (same paths as before:
// outputs/, uploads/, data/). Vercel production/preview writes to Aliyun OSS
// with a private bucket. Generated files are persisted by stable object key;
// browsers only ever receive short-lived signed URLs generated at read time.
//
// If OSS is required (Vercel) but not configured, startup fails with a clear
// error instead of silently falling back to the ephemeral /tmp directory.

const DEFAULT_SIGNED_URL_TTL = 3600;

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
  }
}

let backend = "fs";
let runtimeRoot = process.cwd();
let ossClient = null;
let signedUrlTtl = DEFAULT_SIGNED_URL_TTL;
let initialized = false;

function textOf(value) {
  return value == null ? "" : String(value).trim();
}

export function storageBackend() {
  return backend;
}

export function storageSignedUrlTtl() {
  return signedUrlTtl;
}

export function initStorage(options = {}) {
  const env = options.env || process.env;
  const isVercel = Boolean(options.isVercel);
  const forceBackend = textOf(env.STORAGE_BACKEND).toLowerCase();
  runtimeRoot = options.runtimeRoot || runtimeRoot;
  signedUrlTtl = Number(env.OSS_SIGNED_URL_TTL || DEFAULT_SIGNED_URL_TTL);
  if (!Number.isFinite(signedUrlTtl) || signedUrlTtl < 60) signedUrlTtl = DEFAULT_SIGNED_URL_TTL;

  const region = textOf(env.ALIYUN_OSS_REGION);
  const bucket = textOf(env.ALIYUN_OSS_BUCKET);
  const accessKeyId = textOf(env.ALIYUN_OSS_ACCESS_KEY_ID);
  const accessKeySecret = textOf(env.ALIYUN_OSS_ACCESS_KEY_SECRET);
  const hasOssConfig = Boolean(region && bucket && accessKeyId && accessKeySecret);

  const useOss = forceBackend === "oss" || (isVercel && forceBackend !== "fs");
  if (useOss) {
    if (!hasOssConfig) {
      throw new StorageError(
        "OSS 存储未配置：请在 Vercel 环境变量中设置 ALIYUN_OSS_REGION、ALIYUN_OSS_BUCKET、ALIYUN_OSS_ACCESS_KEY_ID、ALIYUN_OSS_ACCESS_KEY_SECRET。"
        + "本地开发使用默认 filesystem，或显式设置 STORAGE_BACKEND=fs。",
      );
    }
    backend = "oss";
    ossClient = new OSS({
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      secure: true,
      timeout: 30000,
    });
  } else {
    backend = "fs";
    ossClient = null;
  }
  initialized = true;
  return { backend, signedUrlTtl };
}

function assertInitialized() {
  if (!initialized) throw new StorageError("存储适配器尚未初始化");
}

function normalizeKey(key) {
  const raw = textOf(key);
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) throw new StorageError("存储 key 为空");
  for (const part of parts) {
    if (part === "." || part === ".." || part.includes("\0")) {
      throw new StorageError(`非法的存储 key: ${raw}`);
    }
  }
  return parts.join("/");
}

function fsPathFor(key) {
  const normalized = normalizeKey(key);
  return path.join(runtimeRoot, ...normalized.split("/"));
}

/**
 * Persist bytes under a stable object key.
 * @param {string} key e.g. `outputs/kv-123.png`, `uploads/materials/x.png`, `data/assets.json`
 * @param {Buffer|Uint8Array} bytes
 * @param {{contentType?: string}} [options]
 * @returns {Promise<{key: string}>}
 */
export async function storagePut(key, bytes, options = {}) {
  assertInitialized();
  const normalized = normalizeKey(key);
  const buffer = Buffer.from(bytes);
  if (backend === "oss") {
    await ossClient.put(normalized, buffer, {
      headers: options.contentType ? { "Content-Type": options.contentType } : undefined,
    });
    return { key: normalized };
  }
  const filePath = fsPathFor(normalized);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return { key: normalized };
}

/**
 * Read bytes back from storage.
 * @returns {Promise<Buffer>}
 */
export async function storageGet(key) {
  assertInitialized();
  const normalized = normalizeKey(key);
  if (backend === "oss") {
    try {
      const result = await ossClient.get(normalized);
      if (result.res?.status === 404 || result.content == null) {
        throw new StorageError(`对象不存在: ${normalized}`);
      }
      return Buffer.from(result.content);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      const status = error?.status || error?.statusCode || error?.code;
      const message = String(error?.message || "");
      if (status === 404 || /NoSuchKey|specified key does not exist/i.test(message)) {
        throw new StorageError(`对象不存在: ${normalized}`);
      }
      throw error;
    }
  }
  try {
    return await readFile(fsPathFor(normalized));
  } catch {
    throw new StorageError(`对象不存在: ${normalized}`);
  }
}

export async function storageExists(key) {
  assertInitialized();
  const normalized = normalizeKey(key);
  if (backend === "oss") {
    try {
      await ossClient.head(normalized);
      return true;
    } catch {
      return false;
    }
  }
  return existsSync(fsPathFor(normalized));
}

export async function storageDelete(key) {
  assertInitialized();
  const normalized = normalizeKey(key);
  if (backend === "oss") {
    try {
      await ossClient.delete(normalized);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await unlink(fsPathFor(normalized));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a browser-usable URL for an object key.
 * - OSS (private bucket): short-lived signed URL.
 * - filesystem: stable local route path (/outputs/..., /uploads/...).
 * data/ keys are not publicly exposed and return an empty string.
 */
export function storageSignUrl(key, ttlSeconds) {
  assertInitialized();
  const normalized = normalizeKey(key);
  const ttl = Math.max(60, Number(ttlSeconds || signedUrlTtl));
  if (backend === "oss") {
    return ossClient.signatureUrl(normalized, { expires: ttl, method: "GET" });
  }
  if (normalized.startsWith("outputs/")) {
    return `/outputs/${encodeURIComponent(normalized.slice("outputs/".length))}`;
  }
  if (normalized.startsWith("uploads/")) {
    return `/${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }
  return "";
}

export const __storageTesting = {
  normalizeKey,
};
