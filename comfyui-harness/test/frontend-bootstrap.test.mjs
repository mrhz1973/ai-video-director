import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Regression guard for issue #36: the DOM helper `$` was accidentally removed
 * from public/app.js in v0.8.3, aborting frontend bootstrap with a
 * ReferenceError while all server APIs stayed healthy.
 */

const DOM_HELPER = /const \$ = id => document\.getElementById\(id\);/;
// Bare `$(` call not preceded by identifier chars, `.`, or another `$`.
const DOLLAR_CALL = /(?<![\w$.])\$\(/;

const browserEntryModules = [
  "../public/app.js",
  "../public/batch-ui.mjs",
  "../public/output-ui.mjs",
  "../public/gpu-power-ui.mjs"
];

function readModule(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

test("app.js defines the DOM lookup helper before first $() use", () => {
  const source = readModule("../public/app.js");
  const defMatch = source.match(DOM_HELPER);
  assert.ok(defMatch, "app.js must define: const $ = id => document.getElementById(id);");
  const firstUse = source.search(DOLLAR_CALL);
  assert.ok(firstUse >= 0, "app.js is expected to use $() lookups");
  assert.ok(
    source.indexOf(defMatch[0]) < firstUse,
    "the $ helper must be defined before its first use in app.js"
  );
});

test("every browser entry module that calls $() defines its own helper", () => {
  for (const rel of browserEntryModules) {
    const source = readModule(rel);
    if (!DOLLAR_CALL.test(source)) continue;
    assert.ok(
      DOM_HELPER.test(source),
      `${rel} uses $() but does not define the DOM helper`
    );
  }
});

test("app.js bootstrap statements after imports do not run before the helper exists", () => {
  const source = readModule("../public/app.js");
  const lines = source.split("\n");
  const defLine = lines.findIndex(line => DOM_HELPER.test(line));
  assert.ok(defLine >= 0, "helper definition line not found");
  for (let i = 0; i < defLine; i += 1) {
    assert.ok(
      !DOLLAR_CALL.test(lines[i]),
      `line ${i + 1} calls $() before the helper is defined: ${lines[i].trim()}`
    );
  }
});
