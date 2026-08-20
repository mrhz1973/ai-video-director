import test from "node:test";
import assert from "node:assert/strict";
import { assetKindFromFilename, classifyAssetAvailability, probeAssetStatuses } from "../lib/asset-status.mjs";
import { assetStatusKey, parseAssetStatusDescriptors } from "../lib/asset-ref.mjs";
import { buildInputViewQuery, buildInputViewUrl } from "../public/asset-url.mjs";

function viewResponse({ ok = true, status = 200, contentType = "image/png" } = {}) {
  return {
    ok,
    status,
    headers: { get: name => (String(name).toLowerCase() === "content-type" ? contentType : null) },
    body: { cancel: async () => {} }
  };
}

function parseComfyView(url) {
  const parsed = new URL(url);
  return {
    pathname: parsed.pathname,
    filename: parsed.searchParams.get("filename") || "",
    type: parsed.searchParams.get("type") || "",
    subfolder: parsed.searchParams.get("subfolder") ?? ""
  };
}

function recordingFetch(handler) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    return handler(url, init);
  };
  return { fetchImpl, urls };
}

function fixtureFetch(assets) {
  return recordingFetch(url => {
    const view = parseComfyView(url);
    const hit = assets.find(item => item.filename === view.filename && item.subfolder === view.subfolder);
    if (!hit) return viewResponse({ ok: false, status: 404, contentType: "" });
    return viewResponse({ contentType: hit.contentType || "image/png" });
  });
}

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

test("A: root image face.png subfolder empty is available", async () => {
  const { fetchImpl, urls } = fixtureFetch([{ filename: "face.png", subfolder: "" }]);
  const statuses = await probeAssetStatuses(
    [{ filename: "face.png", subfolder: "" }],
    { fetchImpl, comfyUrl: "http://127.0.0.1:8188" }
  );
  assert.equal(statuses["face.png"], "available");
  assert.equal(parseComfyView(urls[0]).subfolder, "");
  assert.equal(parseComfyView(urls[0]).type, "input");
});

test("B: nested face.png probes the member subfolder and is available", async () => {
  const { fetchImpl, urls } = fixtureFetch([
    { filename: "face.png", subfolder: "characters/martino" }
  ]);
  const statuses = await probeAssetStatuses(
    [{ filename: "face.png", subfolder: "characters/martino" }],
    { fetchImpl, comfyUrl: "http://127.0.0.1:8188" }
  );
  assert.equal(statuses["characters/martino/face.png"], "available");
  assert.equal(statuses["face.png"], undefined);
  const probed = parseComfyView(urls[0]);
  assert.equal(probed.filename, "face.png");
  assert.equal(probed.type, "input");
  assert.equal(probed.subfolder, "characters/martino");
  assert.match(urls[0], /\/view\?/);
});

test("C: wrong or missing subfolder is missing", async () => {
  const { fetchImpl } = fixtureFetch([
    { filename: "face.png", subfolder: "characters/martino" }
  ]);
  const wrong = await probeAssetStatuses(
    [{ filename: "face.png", subfolder: "other" }],
    { fetchImpl, comfyUrl: "http://127.0.0.1:8188" }
  );
  assert.equal(wrong["other/face.png"], "missing");
  const root = await probeAssetStatuses(
    [{ filename: "face.png", subfolder: "" }],
    { fetchImpl, comfyUrl: "http://127.0.0.1:8188" }
  );
  assert.equal(root["face.png"], "missing");
});

test("D: legacy filename-only request defaults to root input", async () => {
  const params = new URLSearchParams("filename=face.png");
  const descriptors = parseAssetStatusDescriptors(params);
  assert.deepEqual(descriptors, [{ filename: "face.png", subfolder: "", type: "input" }]);
  const { fetchImpl, urls } = fixtureFetch([{ filename: "face.png", subfolder: "" }]);
  const statuses = await probeAssetStatuses(descriptors, { fetchImpl, comfyUrl: "http://127.0.0.1:8188" });
  assert.equal(statuses["face.png"], "available");
  const probed = parseComfyView(urls[0]);
  assert.equal(probed.filename, "face.png");
  assert.equal(probed.type, "input");
  assert.equal(probed.subfolder, "");
});

test("F: thumbnail URL and asset-status probe share filename, type=input, subfolder", async () => {
  const descriptor = { filename: "face.png", subfolder: "characters/martino" };
  const thumb = new URL(buildInputViewUrl(descriptor), "http://harness.local");
  const { fetchImpl, urls } = fixtureFetch([descriptor]);
  await probeAssetStatuses([descriptor], { fetchImpl, comfyUrl: "http://127.0.0.1:8188" });
  const probed = parseComfyView(urls[0]);
  assert.equal(thumb.searchParams.get("filename"), probed.filename);
  assert.equal(thumb.searchParams.get("type"), probed.type);
  assert.equal(thumb.searchParams.get("subfolder"), probed.subfolder);
  assert.equal(buildInputViewQuery(descriptor), urls[0].split("/view?")[1]);
  assert.equal(assetStatusKey(descriptor), "characters/martino/face.png");
});

test("G: availability probes never call /api/queue or ComfyUI /prompt", async () => {
  const { fetchImpl, urls } = fixtureFetch([{ filename: "face.png", subfolder: "characters/martino" }]);
  await probeAssetStatuses(
    [{ filename: "face.png", subfolder: "characters/martino" }],
    { fetchImpl, comfyUrl: "http://127.0.0.1:8188" }
  );
  assert.equal(urls.length, 1);
  assert.equal(urls.some(url => url.includes("/api/queue") || url.includes("/queue") || url.includes("/prompt")), false);
  assert.match(urls[0], /\/view\?/);
});
