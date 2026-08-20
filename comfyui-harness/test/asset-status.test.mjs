import test from "node:test";
import assert from "node:assert/strict";
import { assetKindFromFilename, classifyAssetAvailability } from "../lib/asset-status.mjs";

test("image 200 with image MIME is available", () => {
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "image/png",
    kind: "image"
  }), "available");
});

test("image 200 with JSON or non-image MIME is not available", () => {
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "application/json",
    kind: "image"
  }), "error");
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "text/html",
    kind: "image"
  }), "error");
});

test("audio is not classified with image MIME rules", () => {
  assert.equal(assetKindFromFilename("theme.wav"), "audio");
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "audio/wav",
    kind: "audio"
  }), "available");
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "application/octet-stream",
    kind: "audio"
  }), "available");
  assert.equal(classifyAssetAvailability({
    ok: true,
    status: 200,
    contentType: "image/png",
    kind: "audio"
  }), "error");
});

test("404 is missing and transport failure is error", () => {
  assert.equal(classifyAssetAvailability({ ok: false, status: 404, kind: "image" }), "missing");
  assert.equal(classifyAssetAvailability({ ok: false, status: 502, kind: "image" }), "error");
});
