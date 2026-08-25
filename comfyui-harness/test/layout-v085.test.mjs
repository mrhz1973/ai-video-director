import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/workspace-v085.css", import.meta.url), "utf8");

function countId(id) {
  const re = new RegExp(`id=["']${id}["']`, "g");
  return (html.match(re) || []).length;
}

function composerSection() {
  const start = html.indexOf('<div class="composer" id="promptComposer">');
  const end = html.indexOf('id="scenaFirstFrame"');
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function promptActionsBlock(section) {
  const start = section.indexOf('class="prompt-actions"');
  assert.ok(start >= 0, "prompt-actions container missing");
  const end = section.indexOf("</div>", section.indexOf('id="send"'));
  assert.ok(end > start);
  return section.slice(start, end);
}

test("Cancella prompt appears exactly once", () => {
  assert.equal(countId("promptClear"), 1);
  assert.match(html, />Cancella prompt</);
});

test("Cronologia appears exactly once", () => {
  assert.equal(countId("promptHistoryToggle"), 1);
  assert.equal((html.match(/>Cronologia</g) || []).length, 1);
});

test("Genera singolo appears exactly once", () => {
  assert.equal(countId("send"), 1);
  assert.match(html, /id="send"[^>]*>GENERA SINGOLO</);
});

test("all three prompt action buttons share the same container", () => {
  const section = composerSection();
  const actions = promptActionsBlock(section);
  assert.match(actions, /id="promptClear"/);
  assert.match(actions, /id="promptHistoryToggle"/);
  assert.match(actions, /id="send"/);
});

test("desktop DOM order is clear -> history -> generate", () => {
  const actions = promptActionsBlock(composerSection());
  const clearIdx = actions.indexOf('id="promptClear"');
  const historyIdx = actions.indexOf('id="promptHistoryToggle"');
  const sendIdx = actions.indexOf('id="send"');
  assert.ok(clearIdx >= 0 && historyIdx > clearIdx && sendIdx > historyIdx);
});

test("legacy full-width prompt-toolbar rows are removed", () => {
  const section = composerSection();
  assert.doesNotMatch(section, /class="prompt-toolbar"/);
  const composerOpen = section.indexOf('id="promptComposer">');
  const textareaIdx = section.indexOf('id="prompt"');
  assert.ok(textareaIdx > composerOpen);
  assert.ok(section.indexOf('id="prompt"') < section.indexOf('class="prompt-actions"'));
});

test("existing IDs used by JS remain unchanged", () => {
  assert.match(app, /\$\("promptClear"\)/);
  assert.match(app, /\$\("promptHistoryToggle"\)/);
  assert.match(app, /\$\("send"\)/);
  assert.match(app, /\$\("promptHistoryPanel"\)/);
});

test("Genera singolo remains visually primary and secondary actions stay compact", () => {
  const actions = promptActionsBlock(composerSection());
  assert.doesNotMatch(actions, /id="send"[^>]*class="[^"]*secondary/);
  assert.match(actions, /class="secondary"[^>]*id="promptClear"/);
  assert.match(actions, /class="secondary"[^>]*id="promptHistoryToggle"/);
  assert.match(css, /\.prompt-actions button\.secondary[\s\S]*width:\s*auto/);
  assert.match(css, /#send[\s\S]*flex:\s*0 0 auto/);
});

test("responsive CSS keeps prompt actions on a wrapping right-aligned row", () => {
  assert.match(css, /\.prompt-actions[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /justify-content:\s*flex-end/);
  assert.match(css, /@media \(max-width: 800px\)/);
});

test("frontend bootstrap regression from v0.8.4 still passes", () => {
  assert.match(app, /const \$ = id => document\.getElementById\(id\);/);
});

test("v085 stylesheet is loaded and package version is 0.11.0", () => {
  assert.match(html, /workspace-v085\.css/);
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.match(pkg.version, /^0\.1[345678]\./);
});
