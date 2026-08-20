import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEGAPIXELS,
  DISPLAY_MULTIPLE,
  MEGAPIXELS_LIMITS,
  approximateResolution,
  classifyResolution,
  comfyAspectRatio,
  estimateDimensions,
  formatResolutionHint,
  isValidMegapixels,
  megapixelsFromSettings,
  parseAspect,
  selectMegapixels,
  validateMegapixels
} from "../public/resolution.mjs";

test("real ComfyUI ResolutionSelector constraints are used", () => {
  assert.deepEqual(MEGAPIXELS_LIMITS, { min: 0.1, max: 16, step: 0.1 });
  assert.equal(DISPLAY_MULTIPLE, 32);
  assert.equal(DEFAULT_MEGAPIXELS, 0.3);
});

test("explicit megapixels are the source of truth", () => {
  assert.equal(selectMegapixels({ megapixels: 0.3 }), 0.3);
  assert.equal(selectMegapixels({ megapixels: 0.4 }), 0.4);
  assert.equal(selectMegapixels({ megapixels: 2.1 }), 2.1);
  assert.equal(selectMegapixels({ megapixels: "0.7" }), 0.7);
});

test("legacy quality labels remain accepted as fallback only", () => {
  assert.equal(selectMegapixels({ quality: "Preview" }), 0.3);
  assert.equal(selectMegapixels({ quality: "Final" }), 0.4);
  assert.equal(selectMegapixels({ megapixels: 1.2, quality: "Preview" }), 1.2);
  assert.equal(selectMegapixels({ megapixels: 0.4, quality: "Preview" }), 0.4);
  assert.equal(selectMegapixels({}), DEFAULT_MEGAPIXELS);
  assert.equal(selectMegapixels({ quality: "Nonsense" }), DEFAULT_MEGAPIXELS);
});

test("invalid megapixel values are rejected", () => {
  for (const value of ["", "   ", null, undefined, NaN, Infinity, -Infinity, 0, -0.4, "abc", {}, [], true, 0.05, 16.1]) {
    assert.equal(isValidMegapixels(value), false, `expected ${String(value)} to be invalid`);
  }
  for (const value of ["", null, NaN, Infinity, 0, -0.4, 0.05, 16.1]) {
    assert.throws(() => selectMegapixels({ megapixels: value }), /megapixels must be a finite number/);
  }
  assert.equal(validateMegapixels(MEGAPIXELS_LIMITS.min), 0.1);
  assert.equal(validateMegapixels(MEGAPIXELS_LIMITS.max), 16);
});

test("project settings prefer explicit megapixels over legacy quality", () => {
  assert.equal(megapixelsFromSettings({ megapixels: 0.6, quality: "Final" }), 0.6);
  assert.equal(megapixelsFromSettings({ quality: "Preview" }), 0.3);
  assert.equal(megapixelsFromSettings({ quality: "Final" }), 0.4);
  assert.equal(megapixelsFromSettings({}), undefined);
  assert.equal(megapixelsFromSettings({ megapixels: "bad", quality: "Final" }), 0.4);
});

test("aspect ratios map to the exact ComfyUI combo strings", () => {
  assert.equal(comfyAspectRatio("1:1"), "1:1 (Square)");
  assert.equal(comfyAspectRatio("3:4"), "3:4 (Portrait Standard)");
  assert.equal(comfyAspectRatio("4:3"), "4:3 (Standard)");
  assert.equal(comfyAspectRatio("9:16"), "9:16 (Portrait Widescreen)");
  assert.equal(comfyAspectRatio("16:9"), "16:9 (Widescreen)");
  assert.equal(comfyAspectRatio("21:9"), "21:9 (Ultrawide)");
  assert.equal(comfyAspectRatio("unknown"), "16:9 (Widescreen)");
  assert.equal(parseAspect("21:9").w, 21);
  assert.equal(parseAspect("21:9").h, 9);
});

test("display dimensions mirror ResolutionSelector rounding to the workflow multiple", () => {
  for (const megapixels of [0.1, 0.3, 0.4, 0.9, 2.1, 3.7, 8.3, 16]) {
    for (const aspect of ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]) {
      const { width, height } = estimateDimensions(megapixels, aspect);
      assert.equal(width % DISPLAY_MULTIPLE, 0);
      assert.equal(height % DISPLAY_MULTIPLE, 0);
    }
  }
  assert.deepEqual(estimateDimensions(0.4, "16:9"), { width: 864, height: 480 });
  assert.deepEqual(estimateDimensions(0.4, "1:1"), { width: 640, height: 640 });
  assert.deepEqual(estimateDimensions(0.4, "9:16"), { width: 480, height: 864 });
  assert.deepEqual(estimateDimensions(0.4, "21:9"), { width: 992, height: 416 });
  assert.deepEqual(estimateDimensions(0.4, "16:9", 8), { width: 864, height: 488 });
});

test("familiar 16:9 resolution classes are labelled informatively", () => {
  assert.equal(approximateResolution(0.4, "16:9").label, "~480p");
  assert.equal(approximateResolution(0.9, "16:9").label, "~720p HD");
  assert.equal(approximateResolution(2.1, "16:9").label, "~1080p Full HD");
  assert.equal(approximateResolution(3.7, "16:9").label, "~1440p QHD");
  assert.equal(approximateResolution(8.3, "16:9").label, "~2160p 4K UHD");
});

test("QHD is never labelled as exact 2K", () => {
  const label = classifyResolution(2560, 1440, "16:9");
  assert.equal(label, "~1440p QHD");
  assert.doesNotMatch(label, /2K/);
  assert.doesNotMatch(formatResolutionHint(3.7, "16:9"), /2K(?! UHD)/);
});

test("non-16:9 ratios describe shape instead of implying a broadcast raster", () => {
  assert.equal(approximateResolution(0.4, "1:1").label, "Square");
  assert.equal(approximateResolution(0.4, "9:16").label, "Portrait");
  assert.equal(approximateResolution(0.4, "4:3").label, "Standard");
  assert.equal(approximateResolution(0.4, "3:4").label, "Portrait Standard");
  assert.equal(approximateResolution(0.4, "21:9").label, "~480p Ultrawide");
  assert.equal(approximateResolution(2.1, "21:9").label, "~1080p Ultrawide");
});

test("no familiar class is claimed when nothing is close enough", () => {
  assert.equal(classifyResolution(5333, 3000, "16:9"), "Widescreen");
});

test("changing aspect updates the hint without changing megapixels", () => {
  const megapixels = 0.4;
  const wide = approximateResolution(megapixels, "16:9");
  const tall = approximateResolution(megapixels, "9:16");
  assert.notDeepEqual([wide.width, wide.height], [tall.width, tall.height]);
  assert.equal(selectMegapixels({ megapixels }), 0.4);
  assert.equal(megapixels, 0.4);
});

test("changing megapixels updates the hint without changing aspect", () => {
  const low = approximateResolution(0.4, "16:9");
  const high = approximateResolution(2.1, "16:9");
  assert.ok(high.width > low.width && high.height > low.height);
  assert.equal(comfyAspectRatio("16:9"), "16:9 (Widescreen)");
});

test("hint formatting stays read-only and reports invalid input", () => {
  assert.equal(formatResolutionHint(0.4, "16:9"), "≈ 864×480 · ~480p");
  assert.equal(formatResolutionHint("", "16:9"), "valore non valido (0.1–16)");
  assert.equal(formatResolutionHint(0, "16:9"), "valore non valido (0.1–16)");
});
