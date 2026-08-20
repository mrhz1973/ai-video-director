import test from "node:test";
import assert from "node:assert/strict";
import { buildInputViewUrl, parseUploadResult } from "../public/asset-url.mjs";

test("thumbnail URL percent-encodes filename, sets type=input, and includes subfolder", () => {
  const url = buildInputViewUrl({
    filename: "Portrait Ref 01.png",
    subfolder: "chars"
  });
  assert.match(url, /^\/api\/view\?/);
  assert.match(url, /type=input/);
  assert.match(url, /filename=Portrait%20Ref%2001\.png/);
  assert.doesNotMatch(url, /filename=Portrait\+Ref/);
  assert.doesNotMatch(url, /%2B/);
  assert.match(url, /subfolder=chars/);
});

test("thumbnail URL includes empty subfolder when absent", () => {
  const url = buildInputViewUrl({ filename: "plain.png" });
  assert.match(url, /filename=plain\.png/);
  assert.match(url, /type=input/);
  assert.match(url, /subfolder=/);
});

test("parseUploadResult keeps ComfyUI name and subfolder without renaming identity", () => {
  const parsed = parseUploadResult({ name: "a b.png", subfolder: "in", type: "input" });
  assert.equal(parsed.filename, "a b.png");
  assert.equal(parsed.subfolder, "in");
  assert.equal(parsed.type, "input");
});
