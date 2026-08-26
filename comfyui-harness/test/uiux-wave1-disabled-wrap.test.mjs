/**
 * Issue #88 review 5029998646 — disabled↔enabled help state transitions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOperatorHelp,
  applyStaticControlHelp,
  CONTROL_HELP,
  syncOperatorHelpState
} from "../public/control-help.mjs";
import {
  readControlHelp,
  resetSharedTooltipControllerForTests,
  syncControlDisabledHelpState,
  unwrapDisabledHelpForControl,
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
      removeChild(node) {
        const arr = list(el);
        const idx = arr.indexOf(node);
        if (idx < 0) throw new Error("not a child");
        arr.splice(idx, 1);
        node.parentNode = null;
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

function focusableWraps(root) {
  const out = [];
  const walk = node => {
    if (node?.getAttribute?.("data-help-wrap") === "1" && Number(node.tabIndex) >= 0) {
      out.push(node);
    }
    for (const child of node?.children || []) walk(child);
  };
  walk(root);
  return out;
}

function assertDisabledFolderState(btn, body, disabledReason) {
  assert.equal(btn.disabled, true);
  assert.equal(countHelpWraps(body), 1);
  const wrap = btn.parentNode;
  assert.equal(wrap.getAttribute("data-help-wrap"), "1");
  assert.equal(Number(wrap.tabIndex), 0);
  assert.equal(wrap.getAttribute("data-help"), disabledReason);
  assert.equal(readControlHelp(wrap), disabledReason);
  assert.doesNotMatch(btn.getAttribute("data-help") || "", /Nessuna cartella/);
}

function assertEnabledFolderState(btn, body, enabledHelp) {
  assert.equal(btn.disabled, false);
  assert.equal(focusableWraps(body).length, 0);
  assert.notEqual(btn.parentNode?.getAttribute?.("data-help-wrap"), "1");
  assert.equal(readControlHelp(btn), enabledHelp);
  assert.doesNotMatch(readControlHelp(btn), /Nessuna cartella/);
  assert.equal(btn.getAttribute("data-help"), enabledHelp);
}

function exerciseFolderTransition({ id, enabledHelp, disabledReason }) {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body, byId } = makeDom();
  const btn = createElement("button");
  btn.id = id;
  btn.disabled = true;
  btn.textContent = "Apri cartella";
  body.append(btn);
  byId.set(id, btn);

  applyOperatorHelp(btn, enabledHelp, { disabledReason, documentRef });
  assertDisabledFolderState(btn, body, disabledReason);

  btn.disabled = false;
  syncOperatorHelpState(btn, { enabledHelp, disabledReason, documentRef });
  assertEnabledFolderState(btn, body, enabledHelp);

  btn.disabled = true;
  syncOperatorHelpState(btn, { enabledHelp, disabledReason, documentRef });
  assertDisabledFolderState(btn, body, disabledReason);
  assert.equal(countHelpWraps(body), 1);
}

test("outputOpenFolder disabled -> enabled -> disabled", () => {
  exerciseFolderTransition({
    id: "outputOpenFolder",
    enabledHelp: CONTROL_HELP.outputOpenFolder,
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled
  });
});

test("cloudMirrorOpenFolder disabled -> enabled -> disabled", () => {
  exerciseFolderTransition({
    id: "cloudMirrorOpenFolder",
    enabledHelp: CONTROL_HELP.cloudMirrorOpenFolder,
    disabledReason: CONTROL_HELP.cloudMirrorOpenFolderDisabled
  });
});

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

test("double applyStaticControlHelp reuses one wrapper for both folder buttons", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body, byId } = makeDom();
  for (const id of ["outputOpenFolder", "cloudMirrorOpenFolder"]) {
    const btn = createElement("button");
    btn.id = id;
    btn.disabled = true;
    body.append(btn);
    byId.set(id, btn);
  }

  applyStaticControlHelp(documentRef);
  applyStaticControlHelp(documentRef);

  assert.equal(countHelpWraps(body), 2);
  for (const id of ["outputOpenFolder", "cloudMirrorOpenFolder"]) {
    const btn = byId.get(id);
    assert.equal(btn.disabled, true);
    assert.equal(btn.parentNode.getAttribute("data-help-wrap"), "1");
    assert.equal(Number(btn.parentNode.tabIndex), 0);
  }
});

test("wrapDisabledHelpForControl is idempotent when already wrapped", () => {
  const { documentRef, createElement, body } = makeDom();
  const btn = createElement("button");
  btn.disabled = true;
  body.append(btn);
  applyOperatorHelp(btn, "azione normale", {
    disabledReason: "prima ragione",
    documentRef
  });
  const first = btn.parentNode;
  const second = wrapDisabledHelpForControl(documentRef, btn, "seconda ragione");
  assert.equal(first, second);
  assert.equal(countHelpWraps(body), 1);
  assert.match(first.getAttribute("data-help"), /seconda ragione/);
  assert.equal(btn.getAttribute("data-help"), "azione normale");
});

test("createSessionClipCard already-copied cloud stays disabled with one accessible wrapper", () => {
  for (const status of ["copied", "already-copied"]) {
    const { documentRef, createElement, body } = makeDom();
    let cloudCalls = 0;
    const card = createSessionClipCard({
      createElement,
      createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }
    }, {
      id: `clip-${status}`,
      filename: "clip.mp4",
      url: "/api/view?filename=clip.mp4",
      available: true,
      cloudMirror: { status }
    }, {
      onCloudMirrorCopy: () => { cloudCalls += 1; }
    });
    body.append(card);
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
    assert.equal(cloudCalls, 0);
  }
});

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

test("unwrap leaves enabled control without wrapper focus stop", () => {
  const { documentRef, createElement, body } = makeDom();
  const btn = createElement("button");
  btn.disabled = true;
  body.append(btn);
  applyOperatorHelp(btn, CONTROL_HELP.outputOpenFolder, {
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled,
    documentRef
  });
  btn.disabled = false;
  syncControlDisabledHelpState(btn, {
    enabledHelp: CONTROL_HELP.outputOpenFolder,
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled,
    documentRef
  });
  unwrapDisabledHelpForControl(btn);
  assert.equal(focusableWraps(body).length, 0);
  assert.equal(readControlHelp(btn), CONTROL_HELP.outputOpenFolder);
});
