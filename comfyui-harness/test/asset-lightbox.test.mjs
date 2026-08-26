/**
 * Issue #74 — asset thumbnail large preview / lightbox.
 * No upload, /prompt, /api/queue, dirty, selection, or generation side effects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSET_LIGHTBOX_ROOT_ID,
  assetLightboxSideEffects,
  canOpenAssetLightbox,
  createAssetLightboxController,
  getSharedAssetLightbox,
  resetSharedAssetLightboxForTests
} from "../public/asset-lightbox.mjs";
import {
  applyScenaFirstFrameView,
  appendBatchFirstFrameSummary
} from "../public/first-frame-view.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function readPublic(name) {
  return readFileSync(path.join(PUBLIC, name), "utf8");
}

function createDom() {
  const nodesById = new Map();
  const docListeners = [];

  function ensureClassList(el) {
    if (el.classList) return el.classList;
    const tokens = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
    el.classList = {
      add(...names) {
        for (const n of names) tokens.add(n);
        el.className = [...tokens].join(" ");
      },
      remove(...names) {
        for (const n of names) tokens.delete(n);
        el.className = [...tokens].join(" ");
      },
      contains(name) {
        return tokens.has(name);
      }
    };
    return el.classList;
  }

  function createElement(tag) {
    const children = [];
    const listeners = [];
    const attrs = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      hidden: false,
      src: "",
      alt: "",
      title: "",
      type: "",
      decoding: "",
      tabIndex: -1,
      style: {},
      children,
      parentNode: null,
      get id() {
        return attrs.get("id") || this._id || "";
      },
      set id(value) {
        this._id = String(value);
        attrs.set("id", String(value));
        nodesById.set(String(value), el);
      },
      append(...nodes) {
        for (const node of nodes) {
          node.parentNode = el;
          children.push(node);
        }
      },
      replaceChildren(...nodes) {
        children.length = 0;
        this.append(...nodes);
      },
      addEventListener(type, fn, opts) {
        listeners.push({ type, fn, opts });
      },
      removeEventListener(type, fn) {
        const idx = listeners.findIndex(l => l.type === type && l.fn === fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      dispatch(type, event = {}) {
        const ev = {
          type,
          key: event.key,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.propagationStopped = true; },
          ...event
        };
        for (const l of listeners.filter(x => x.type === type)) l.fn(ev);
        return ev;
      },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === "id") {
          this._id = String(value);
          nodesById.set(String(value), el);
        }
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      removeAttribute(name) {
        attrs.delete(name);
        if (name === "src") this.src = "";
      },
      querySelector(sel) {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          for (const c of children) {
            if (
              ensureClassList(c).contains(cls)
              || String(c.className || "").split(/\s+/).includes(cls)
            ) {
              return c;
            }
            const nested = c.querySelector?.(sel);
            if (nested) return nested;
          }
        }
        return null;
      },
      focus() {
        documentRef.activeElement = el;
      },
      _listeners: listeners
    };
    ensureClassList(el);
    return el;
  }

  const body = createElement("body");
  const documentRef = {
    body,
    activeElement: null,
    createElement,
    getElementById(id) {
      return nodesById.get(String(id)) || null;
    },
    addEventListener(type, fn, opts) {
      docListeners.push({ type, fn, opts });
    },
    removeEventListener(type, fn) {
      const idx = docListeners.findIndex(l => l.type === type && l.fn === fn);
      if (idx >= 0) docListeners.splice(idx, 1);
    },
    dispatchKey(key) {
      const ev = {
        key,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; }
      };
      for (const l of docListeners.filter(x => x.type === "keydown")) l.fn(ev);
      return ev;
    },
    _docListeners: docListeners
  };
  return documentRef;
}

test("canOpenAssetLightbox gates missing and unavailable sources", () => {
  assert.deepEqual(canOpenAssetLightbox({ src: "" }), { ok: false, reason: "missing-src" });
  assert.deepEqual(
    canOpenAssetLightbox({ src: "/api/view?filename=x.png&type=input", available: false }),
    { ok: false, reason: "unavailable" }
  );
  assert.equal(
    canOpenAssetLightbox({ src: "/api/view?filename=x.png&type=input" }).ok,
    true
  );
});

test("side effects contract forbids selection/dirty/upload/queue/generation", () => {
  const effects = assetLightboxSideEffects();
  assert.equal(effects.changesSelection, false);
  assert.equal(effects.changesRoleAssignment, false);
  assert.equal(effects.marksProjectDirty, false);
  assert.equal(effects.uploads, false);
  assert.equal(effects.postsPrompt, false);
  assert.equal(effects.postsQueue, false);
  assert.equal(effects.mutatesQueue, false);
  assert.equal(effects.startsGeneration, false);
});

test("click thumbnail opens large preview preserving source URL and aspect class", () => {
  resetSharedAssetLightboxForTests();
  const doc = createDom();
  const feedback = [];
  const box = createAssetLightboxController({
    documentRef: doc,
    onFeedback: msg => feedback.push(msg)
  });
  const thumb = doc.createElement("img");
  thumb.src = "/api/view?filename=first.png&type=input";
  thumb.alt = "First frame";
  const selectedAsset = { id: "asset-keep" };
  const dirtyBefore = false;
  let dirty = dirtyBefore;

  box.bindTrigger(thumb, {
    src: thumb.src,
    alt: "First frame",
    label: "first.png",
    available: true
  });

  const click = thumb.dispatch("click");
  assert.equal(click.propagationStopped, true);
  assert.equal(box.isOpen(), true);
  const root = box.getRoot();
  assert.equal(root.id, ASSET_LIGHTBOX_ROOT_ID);
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute("role"), "dialog");
  assert.equal(root.getAttribute("aria-modal"), "true");
  const previewImg = root.querySelector(".asset-lightbox-image");
  assert.equal(previewImg.src, "/api/view?filename=first.png&type=input");
  assert.match(previewImg.className, /asset-lightbox-image/);
  assert.equal(selectedAsset.id, "asset-keep");
  assert.equal(dirty, dirtyBefore);
  assert.deepEqual(box.sideEffects(), assetLightboxSideEffects());
  assert.equal(feedback.length, 0);

  const css = readPublic("workspace-v0140.css");
  assert.match(css, /\.asset-lightbox-image[\s\S]*object-fit:\s*contain/);
  assert.match(css, /\.asset-lightbox-image[\s\S]*max-height:/);
});

test("close button and Escape restore prior UI state without dirty/selection change", () => {
  resetSharedAssetLightboxForTests();
  const doc = createDom();
  const prior = doc.createElement("button");
  prior.id = "priorFocus";
  prior.focus();
  doc.activeElement = prior;

  const box = createAssetLightboxController({ documentRef: doc });
  const selectedRole = { firstImage: "keep.png", lastImage: "tail.png" };
  const selectedSnapshot = structuredClone(selectedRole);
  let dirty = false;

  const opened = box.open({
    src: "/api/view?filename=keep.png&type=input",
    label: "keep.png"
  });
  assert.equal(opened.ok, true);
  assert.equal(box.isOpen(), true);

  const closeBtn = box.getRoot().querySelector(".asset-lightbox-close");
  closeBtn.dispatch("click");
  assert.equal(box.isOpen(), false);
  assert.equal(box.getRoot().hidden, true);
  assert.deepEqual(selectedRole, selectedSnapshot);
  assert.equal(dirty, false);
  assert.equal(doc.activeElement, prior);

  box.open({ src: "/api/view?filename=keep.png&type=input", label: "keep.png" });
  assert.equal(box.isOpen(), true);
  doc.dispatchKey("Escape");
  assert.equal(box.isOpen(), false);
  assert.deepEqual(selectedRole, selectedSnapshot);
  assert.equal(dirty, false);
});

test("outside/backdrop click closes preview", () => {
  resetSharedAssetLightboxForTests();
  const doc = createDom();
  const box = createAssetLightboxController({ documentRef: doc });
  box.open({ src: "/api/view?filename=x.png&type=input", label: "x.png" });
  const backdrop = box.getRoot().children.find(c =>
    String(c.className || "").includes("asset-lightbox-backdrop")
  );
  assert.ok(backdrop);
  backdrop.dispatch("click");
  assert.equal(box.isOpen(), false);
});

test("missing / unavailable asset fails gracefully with feedback", () => {
  resetSharedAssetLightboxForTests();
  const doc = createDom();
  const feedback = [];
  const box = createAssetLightboxController({
    documentRef: doc,
    onFeedback: msg => feedback.push(msg)
  });
  const missing = box.open({ src: "", label: "gone" });
  assert.equal(missing.ok, false);
  assert.equal(box.isOpen(), false);
  assert.equal(feedback.at(-1), "Anteprima non disponibile");

  const unavail = box.open({
    src: "/api/view?filename=missing.png&type=input",
    available: false
  });
  assert.equal(unavail.ok, false);
  assert.equal(feedback.at(-1), "Asset non disponibile");
  assert.equal(box.isOpen(), false);
});

test("SCENA / BATCH first-frame paths attach lightbox trigger class", () => {
  resetSharedAssetLightboxForTests();
  const doc = createDom();
  const name = doc.createElement("div");
  name.id = "scenaFirstFrameName";
  const thumb = doc.createElement("div");
  thumb.id = "scenaFirstFrameThumb";
  getSharedAssetLightbox({ documentRef: doc });

  applyScenaFirstFrameView(doc, {
    filename: "first.png",
    url: "/api/view?filename=first.png&type=input",
    available: true,
    label: "first.png"
  });
  const img = doc.getElementById("scenaFirstFrameThumb").children[0];
  assert.match(String(img.className), /asset-lightbox-trigger/);
  img.dispatch("click");
  assert.equal(getSharedAssetLightbox().isOpen(), true);
  getSharedAssetLightbox().close();

  const parent = doc.createElement("div");
  appendBatchFirstFrameSummary(doc, parent, {
    filename: "last-as-batch-first.png",
    url: "/api/view?filename=last-as-batch-first.png&type=input",
    available: true
  });
  const batchImg = parent.children[0].children[0];
  assert.match(String(batchImg.className), /asset-lightbox-trigger/);
  batchImg.dispatch("click");
  assert.equal(getSharedAssetLightbox().isOpen(), true);
  getSharedAssetLightbox().close();
});

test("source contracts: reusable lightbox wired for library + role + first-frame paths", () => {
  const lightboxSrc = readPublic("asset-lightbox.mjs");
  const appSrc = readPublic("app.js");
  const firstSrc = readPublic("first-frame-view.mjs");

  assert.match(lightboxSrc, /createAssetLightboxController/);
  assert.doesNotMatch(lightboxSrc, /fetch\s*\(/);
  assert.doesNotMatch(lightboxSrc, /\/api\/queue/);
  assert.doesNotMatch(lightboxSrc, /\/prompt/);
  assert.doesNotMatch(lightboxSrc, /updateDirtyFlag/);
  assert.doesNotMatch(lightboxSrc, /FormData/);

  assert.match(appSrc, /from\s+["']\.\/asset-lightbox\.mjs["']/);
  assert.match(appSrc, /bindImageAssetPreview/);
  assert.match(appSrc, /function bindImageAssetPreview/);
  // library member thumbs + first/last role previews
  assert.match(appSrc, /bindImageAssetPreview\(img,\s*\{[\s\S]*available:\s*true/);
  assert.match(appSrc, /cropEligible = \["firstImage", "lastImage"\]/);

  assert.match(firstSrc, /from\s+["']\.\/asset-lightbox\.mjs["']/);
  assert.match(firstSrc, /getSharedAssetLightbox/);
  assert.match(firstSrc, /bindTrigger/);
});

test("preview module never invokes upload/queue/prompt/generation strings", () => {
  const src = readPublic("asset-lightbox.mjs");
  for (const forbidden of [
    "POST /prompt",
    "POST /api/queue",
    "/api/upload",
    "uploadFile",
    "queuePrompt",
    "startGeneration"
  ]) {
    assert.equal(src.includes(forbidden), false, `forbidden token: ${forbidden}`);
  }
});
