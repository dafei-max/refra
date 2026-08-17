import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [server, materialIndex, packagedAssets, uploadedMaterials] = await Promise.all([
  readFile(path.join(root, "server.mjs"), "utf-8"),
  readFile(path.join(root, "data", "materials.json"), "utf-8").then(JSON.parse),
  readdir(path.join(root, "素材资产库图片素材")),
  readdir(path.join(root, "uploads", "materials")),
]);

test("packaged inspiration library is empty", () => {
  assert.equal(materialIndex.library_version, 2);
  assert.equal(materialIndex.count, 0);
  assert.deepEqual(materialIndex.materials, []);
  assert.deepEqual(packagedAssets, [".gitkeep"]);
  assert.deepEqual(uploadedMaterials, [".gitkeep"]);
});

test("older OSS material indexes are cleared once and uploaded material objects are removed", () => {
  assert.match(server, /const MATERIAL_LIBRARY_VERSION = 2;/);
  assert.match(server, /Number\(payload\.library_version \|\| 0\) < MATERIAL_LIBRARY_VERSION/);
  assert.match(server, /await deleteUploadedMaterialImage\(material\)/);
  assert.match(server, /return saveMaterials\(\[\]\)/);
  assert.match(server, /library_version: MATERIAL_LIBRARY_VERSION/);
});
