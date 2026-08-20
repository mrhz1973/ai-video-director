import test from "node:test";
import assert from "node:assert/strict";
import {
  assetStatusKey,
  lookupAvailability,
  parseAssetStatusDescriptors,
  uniqueAssetDescriptors
} from "../lib/asset-ref.mjs";

test("status map keys: root stays filename, nested uses subfolder/filename", () => {
  assert.equal(assetStatusKey({ filename: "face.png", subfolder: "" }), "face.png");
  assert.equal(assetStatusKey({ filename: "face.png" }), "face.png");
  assert.equal(assetStatusKey({ filename: "face.png", subfolder: "characters/martino" }), "characters/martino/face.png");
});

test("duplicate filenames in different subfolders keep distinct keys; first library match is a separate concern", () => {
  const unique = uniqueAssetDescriptors([
    { filename: "face.png", subfolder: "" },
    { filename: "face.png", subfolder: "characters/martino" }
  ]);
  assert.deepEqual(unique.map(item => assetStatusKey(item)), [
    "face.png",
    "characters/martino/face.png"
  ]);
});

test("legacy filename-only query params default subfolder to empty root input", () => {
  const parsed = parseAssetStatusDescriptors(new URLSearchParams("filename=face.png&filenames=other.png"));
  assert.equal(parsed[0].subfolder, "");
  assert.equal(parsed[1].subfolder, "");
  assert.equal(parsed[0].type, "input");
});

test("lookupAvailability does not inherit root filename status for a nested member", () => {
  const availability = { "face.png": "available" };
  assert.equal(lookupAvailability(availability, { filename: "face.png", subfolder: "" }), "available");
  assert.equal(
    lookupAvailability(availability, { filename: "face.png", subfolder: "characters/martino" }),
    "unknown"
  );
  assert.equal(
    lookupAvailability(
      { "characters/martino/face.png": "available" },
      { filename: "face.png", subfolder: "characters/martino" }
    ),
    "available"
  );
});
