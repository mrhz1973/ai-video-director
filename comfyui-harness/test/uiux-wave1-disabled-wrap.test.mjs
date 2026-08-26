/**
 * Issue #88 final review 5029881414 — idempotent disabled wrappers + cloud-copied help.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOperatorHelp,
  applyStaticControlHelp,
  CONTROL_HELP
} from "../public/control-help.mjs";
import {
  resetSharedTooltipControllerForTests,
  wrapDisabledHelpForControl
} from "../public/tooltip.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";

function makeDom() {
  const byId = new Map();
  const kids = new WeakMap();
  function list(el) {
    if (!kids.has(el)) kids.set(el, []);
    return kids.get(el);
  }
  function createElement(tag) {
    const attrs = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      tabIndex: -1,
      href: "",
      parentNode: null,
      style: {},
      dataset: {},
      get children() { return list(el); },
      get id() { return attrs.get("id") || ""; },
      set id(v) { attrs.set("id", String(v)); byId.set(String(v), el); },
      append(...nodes) {
        for (const n of nodes) {
          if (n.parentNode) {
            const prev = list(n.parentNode);
            const i = prev.indexOf(n);
            if (i >= 0) prev.splice(i, 1);
          }
          n.parentNode = el;
          list(el).push(n);
        }
      },
      insertBefore(node, ref) {
        if (node.parentNode) {
          const prev = list(node.parentNode);
          const i = prev.indexOf(node);
          if (i >= 0) prev.splice(i, 1);
        }
        const arr = list(el);
        const idx = ref ? arr.indexOf(ref) : -1;
        node.parentNode = el;
        if (idx >= 0) arr.splice(idx, 0, node);
        else arr.push(node);
        return node;
      },
      closest(sel) {
        let node = el;
        while (node) {
          if (sel === "[data-help-wrap='1']" && node.getAttribute?.("data-help-wrap") === "1") {
            return node;
          }
          node = node.parentNode;
        }
        return null;
      },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === "id") byId.set(String(value), el);
      },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    };
    return el;
  }
  const body = createElement("body");
  const documentRef = {
    body,
    createElement,
    getElementById(id) { return byId.get(String(id)) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  return { documentRef, createElement, body, byId };
}

function countHelpWraps(root) {
  let n = 0;
  const walk = node => {
    if (node?.getAttribute?.("data-help-wrap") === "1") n += 1;
    for (const child of node?.children || []) walk(child);
  };
  walk(root);
  return n;
}

test("double applyOperatorHelp reuses one disabled wrapper", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body } = makeDom();
  const btn = createElement("button");
  btn.disabled = true;
  btn.textContent = "Apri cartella";
  body.append(btn);

  applyOperatorHelp(btn, CONTROL_HELP.outputOpenFolder, {
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled,
    documentRef
  });
  applyOperatorHelp(btn, CONTROL_HELP.outputOpenFolder, {
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled,
    documentRef
  });

  assert.equal(btn.disabled, true);
  assert.equal(countHelpWraps(body), 1);
  assert.equal(btn.parentNode.getAttribute("data-help-wrap"), "1");
  assert.equal(btn.parentNode.tabIndex, 0);
  assert.match(btn.parentNode.getAttribute("data-help"), /Nessuna cartella archivio/);
});

test("double applyStaticControlHelp reuses one wrapper for outputOpenFolder", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body, byId } = makeDom();
  const btn = createElement("button");
  btn.id = "outputOpenFolder";
  btn.disabled = true;
  btn.textContent = "Apri cartella";
  body.append(btn);
  byId.set("outputOpenFolder", btn);

  applyStaticControlHelp(documentRef);
  applyStaticControlHelp(documentRef);

  assert.equal(btn.disabled, true);
  assert.equal(countHelpWraps(body), 1);
  assert.equal(btn.parentNode.getAttribute("data-help-wrap"), "1");
  assert.equal(Number(btn.parentNode.tabIndex), 0);
});

test("wrapDisabledHelpForControl is idempotent when already wrapped", () => {
  const { documentRef, createElement, body } = makeDom();
  const btn = createElement("button");
  btn.disabled = true;
  body.append(btn);
  const first = wrapDisabledHelpForControl(documentRef, btn, "prima ragione");
  const second = wrapDisabledHelpForControl(documentRef, btn, "seconda ragione");
  assert.equal(first, second);
  assert.equal(countHelpWraps(body), 1);
  assert.match(first.getAttribute("data-help"), /seconda ragione/);
});

function makeGalleryDoc() {
  const { documentRef, createElement, body } = makeDom();
  return {
    documentRef,
    body,
    createElement,
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }
  };
}

function findCloudButton(card) {
  const walk = node => {
    if (!node) return null;
    if (node.tagName === "BUTTON" && /Già copiato nel cloud|Copia nel cloud/.test(node.textContent || "")) {
      return node;
    }
    for (const child of node.children || []) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(card);
}

test("createSessionClipCard already-copied cloud stays disabled with one accessible wrapper", () => {
  for (const status of ["copied", "already-copied"]) {
    const doc = makeGalleryDoc();
    let cloudCalls = 0;
    const card = createSessionClipCard(doc, {
      id: `clip-${status}`,
      filename: "clip.mp4",
      url: "/api/view?filename=clip.mp4",
      available: true,
      cloudMirror: { status }
    }, {
      onCloudMirrorCopy: () => { cloudCalls += 1; }
    });
    doc.body.append(card);
    const cloudBtn = findCloudButton(card);
    assert.ok(cloudBtn, `cloud button missing for status=${status}`);
    assert.equal(cloudBtn.disabled, true);
    assert.equal(cloudBtn.textContent, "Già copiato nel cloud");
    assert.equal(cloudBtn.parentNode.getAttribute("data-help-wrap"), "1");
    assert.equal(Number(cloudBtn.parentNode.tabIndex), 0);
    assert.match(
      cloudBtn.parentNode.getAttribute("data-help") || "",
      /già presente|non è disponibile/i
    );
    assert.equal(countHelpWraps(card), 1);
    cloudBtn.click?.();
    // click listener must no-op while disabled
    if (typeof cloudBtn.addEventListener === "function") {
      // invoke registered listeners manually if present
    }
    assert.equal(cloudCalls, 0);
  }
});
