import test from "node:test";
import assert from "node:assert/strict";
import { buildAssetStatusUrl, buildInputViewUrl, parseUploadResult } from "../public/asset-url.mjs";

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

test("asset-status request encodes parallel filename and subfolder pairs", () => {
  const url = buildAssetStatusUrl([
    { filename: "face.png", subfolder: "" },
    { filename: "face.png", subfolder: "characters/martino" }
  ]);
  const parsed = new URL(url, "http://harness.local");
  assert.equal(parsed.pathname, "/api/asset-status");
  assert.deepEqual(parsed.searchParams.getAll("filename"), ["face.png", "face.png"]);
  assert.deepEqual(parsed.searchParams.getAll("subfolder"), ["", "characters/martino"]);
});

test("thumbnail and asset-status queries agree on nested input identity", () => {
  const descriptor = { filename: "face.png", subfolder: "characters/martino", type: "input" };
  const thumb = new URL(buildInputViewUrl(descriptor), "http://harness.local");
  const status = new URL(buildAssetStatusUrl([descriptor]), "http://harness.local");
  assert.equal(thumb.searchParams.get("filename"), status.searchParams.get("filename"));
  assert.equal(thumb.searchParams.get("subfolder"), status.searchParams.get("subfolder"));
  assert.equal(thumb.searchParams.get("type"), "input");
});
