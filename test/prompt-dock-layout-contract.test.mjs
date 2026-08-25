import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("prompt dock uses a flexible text region instead of margin positioning", () => {
  assert.doesNotMatch(styles, /\.prompt-dock(?:\.free-mode)?\s+\.dock-actions\s*\{[^}]*margin-top:\s*auto/);
  assert.match(styles, /\.text-wrap\s*\{[^}]*flex:\s*1 1 60px;[^}]*min-height:\s*0;[^}]*height:\s*auto;/);
  assert.match(styles, /#visualDescriptionInput\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;/);
});

test("prompt textarea height is not mutated by input JavaScript", () => {
  assert.doesNotMatch(app, /visualDescriptionInput\.style\.height/);
  assert.doesNotMatch(app, /autoResizeDescription/);
});
