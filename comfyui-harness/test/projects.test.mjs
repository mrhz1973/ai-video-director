import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import {
  SCHEMA_VERSION,
  addGroup,
  addMembersToGroup,
  assignRole,
  buildSubmissionFiles,
  classifyDroppedFiles,
  clearRolesForFilenames,
  createGroup,
  createMember,
  emptyLibrary,
  filterFilesForActivePreset,
  isProjectDirty,
  isValidProjectId,
  listAllMembers,
  normalizeProject,
  parseProjectJson,
  projectEditorSnapshot,
  removeGroup,
  removeMember,
  renameGroup,
  reorderMembers,
  resolveSafeProjectPathNode,
  restoreModelSelection,
  simulateWorkflowBindingView,
  toPersistedProject,
  uniqueProjectId
} from "../lib/projects.mjs";
import { createProjectStore } from "../lib/project-store.mjs";

test("project id validation rejects traversal and absolute paths", () => {
  assert.equal(isValidProjectId("portovenere-demo"), true);
  assert.equal(isValidProjectId("../etc"), false);
  assert.equal(isValidProjectId("C:/Windows"), false);
  assert.equal(isValidProjectId("a/b"), false);
  assert.equal(isValidProjectId("a\\b"), false);
  assert.throws(() => resolveSafeProjectPathNode(path, "C:\\projects", "../x"));
});

test("legacy project normalizes to schemaVersion 1 library without rewriting on disk semantics", () => {
  const legacy = {
    id: "legacy-demo",
    label: "Legacy Demo",
    workflowId: "minimax-h3-i2v",
    prompt: "sanitized prompt",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1 },
    files: { firstImage: "ref-a.png" }
  };
  const normalized = normalizeProject(legacy);
  assert.equal(normalized.schemaVersion, SCHEMA_VERSION);
  assert.equal(normalized._legacySchemaVersion, 0);
  assert.equal(normalized.files.firstImage, "ref-a.png");
  assert.equal(normalized.library.elements.length, 1);
  assert.equal(normalized.library.elements[0].members[0].filename, "ref-a.png");
  assert.equal(normalized.library.locations.length, 0);
});

test("v1 grouped schema round-trip preserves categories and member order", () => {
  const project = {
    id: "demo-project",
    label: "Demo",
    workflowId: "minimax-h3-reference",
    prompt: "x",
    settings: { megapixels: 0.3, steps: 20, duration: 10, aspect: "16:9", seed: 2 },
    library: {
      elements: [createGroup({
        label: "Subject",
        members: [
          createMember({ filename: "front.png", originalName: "front.png", label: "front" }),
          createMember({ filename: "profile.png", originalName: "profile.png", label: "profile" })
        ]
      })],
      locations: [createGroup({
        label: "Place",
        members: [createMember({ filename: "harbor.png", originalName: "harbor.png" })]
      })],
      objects: [createGroup({
        label: "Prop",
        members: [createMember({ filename: "radio.png", originalName: "radio.png" })]
      })],
      audio: [createGroup({
        label: "Ambience",
        members: [createMember({ filename: "wind.wav", originalName: "wind.wav", type: "audio" })]
      })]
    },
    files: {
      characterBody: "front.png",
      environment: "harbor.png",
      prop: "radio.png",
      audioReference: "wind.wav"
    }
  };
  const persisted = toPersistedProject(project);
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.library.elements[0].members.map(m => m.filename).join(","), "front.png,profile.png");
  const again = normalizeProject(persisted);
  assert.equal(again.library.audio[0].members[0].type, "audio");
  assert.equal(again.files.characterBody, "front.png");
  assert.ok(!("promptId" in persisted));
  assert.ok(!("clientId" in persisted));
});

test("group create rename delete and member reorder", () => {
  let library = emptyLibrary();
  library = addGroup(library, "elements", createGroup({ id: "g1", label: "Martino", members: [] }));
  library = renameGroup(library, "elements", "g1", "Martino V2");
  assert.equal(library.elements[0].label, "Martino V2");
  library = addMembersToGroup(library, "elements", "g1", [
    createMember({ id: "m1", filename: "a.png", originalName: "a.png" }),
    createMember({ id: "m2", filename: "b.png", originalName: "b.png" }),
    createMember({ id: "m3", filename: "c.png", originalName: "c.png" })
  ]);
  library = reorderMembers(library, "elements", "g1", 2, 0);
  assert.deepEqual(library.elements[0].members.map(m => m.filename), ["c.png", "a.png", "b.png"]);
  const removed = removeMember(library, "elements", "g1", "m1");
  library = removed.library;
  assert.equal(removed.removedFilename, "a.png");
  assert.equal(library.elements[0].members.length, 2);
  const gone = removeGroup(library, "elements", "g1");
  assert.equal(gone.library.elements.length, 0);
  assert.deepEqual(gone.removedFilenames.sort(), ["b.png", "c.png"]);
});

test("category drop classification rejects cross-type files", () => {
  const images = classifyDroppedFiles("elements", [
    { name: "a.png", type: "image/png" },
    { name: "b.wav", type: "audio/wav" }
  ]);
  assert.equal(images.accepted.length, 1);
  assert.equal(images.rejected.length, 1);
  const audio = classifyDroppedFiles("audio", [
    { name: "b.wav", type: "audio/wav" },
    { name: "a.png", type: "image/png" }
  ]);
  assert.equal(audio.accepted.length, 1);
  assert.equal(audio.rejected[0].name, "a.png");
});

test("removing member or group clears role assignments", () => {
  let library = addGroup(emptyLibrary(), "elements", createGroup({
    id: "g1",
    label: "X",
    members: [createMember({ id: "m1", filename: "one.png", originalName: "one.png" })]
  }));
  let files = assignRole({}, "firstImage", "one.png");
  const memberGone = removeMember(library, "elements", "g1", "m1");
  files = clearRolesForFilenames(files, [memberGone.removedFilename]);
  assert.equal(files.firstImage, undefined);

  library = addGroup(emptyLibrary(), "locations", createGroup({
    id: "g2",
    label: "Loc",
    members: [createMember({ filename: "place.png", originalName: "place.png" })]
  }));
  files = assignRole({}, "environment", "place.png");
  const groupGone = removeGroup(library, "locations", "g2");
  files = clearRolesForFilenames(files, groupGone.removedFilenames);
  assert.equal(files.environment, undefined);
});

test("workflow change retains library and preserves inactive bindings in storage", () => {
  const library = addGroup(emptyLibrary(), "elements", createGroup({
    label: "Keep",
    members: [createMember({ filename: "a.png", originalName: "a.png" })]
  }));
  const stored = {
    firstImage: "a.png",
    lastImage: "b.png",
    characterBody: "c.png"
  };
  const t2v = filterFilesForActivePreset(stored, []);
  assert.deepEqual(t2v, {});
  assert.equal(stored.firstImage, "a.png");
  const back = filterFilesForActivePreset(stored, ["firstImage"]);
  assert.deepEqual(back, { firstImage: "a.png" });
  assert.equal(library.elements.length, 1);
});

test("submission blocks missing required roles and preserves Ref2VA order in library", () => {
  const library = {
    ...emptyLibrary(),
    elements: [createGroup({
      label: "Char",
      members: [
        createMember({ filename: "body.png", originalName: "body.png" }),
        createMember({ filename: "expr1.png", originalName: "expr1.png" }),
        createMember({ filename: "expr2.png", originalName: "expr2.png" })
      ]
    })]
  };
  assert.deepEqual(listAllMembers(library).map(m => m.filename), ["body.png", "expr1.png", "expr2.png"]);
  const built = buildSubmissionFiles({
    files: {
      characterBody: "body.png",
      characterExpressions1: "expr1.png",
      firstImage: "should-not-submit.png"
    },
    library,
    availability: { "body.png": "available", "expr1.png": "missing", "should-not-submit.png": "available" },
    activeKeys: ["characterBody", "characterExpressions1", "environment"],
    requiredKeys: ["characterBody", "characterExpressions1", "environment"]
  });
  assert.ok(built.missingRequired.includes("characterExpressions1"));
  assert.ok(built.missingRequired.includes("environment"));
  assert.equal(built.files.characterBody, "body.png");
  assert.equal(built.files.characterExpressions1, undefined);
  assert.equal(built.files.firstImage, undefined);
});

test("I2VA -> T2VA -> I2VA keeps firstImage binding in storage", () => {
  const i2vKeys = ["firstImage"];
  const t2vKeys = [];
  let stored = { firstImage: "martino-front.png" };
  let view = simulateWorkflowBindingView(stored, i2vKeys);
  assert.equal(view.active.firstImage, "martino-front.png");
  view = simulateWorkflowBindingView(stored, t2vKeys);
  assert.equal(view.active.firstImage, undefined);
  assert.equal(view.stored.firstImage, "martino-front.png");
  view = simulateWorkflowBindingView(stored, i2vKeys);
  assert.equal(view.active.firstImage, "martino-front.png");
});

test("Ref2VA -> I2VA -> Ref2VA keeps Ref2VA bindings in storage", () => {
  const refKeys = ["characterBody", "environment", "audioReference"];
  const i2vKeys = ["firstImage"];
  const stored = {
    characterBody: "body.png",
    environment: "harbor.png",
    audioReference: "wind.wav",
    firstImage: "front.png"
  };
  let view = simulateWorkflowBindingView(stored, refKeys);
  assert.equal(view.active.characterBody, "body.png");
  assert.equal(view.active.firstImage, undefined);
  view = simulateWorkflowBindingView(stored, i2vKeys);
  assert.equal(view.active.firstImage, "front.png");
  assert.equal(view.stored.characterBody, "body.png");
  view = simulateWorkflowBindingView(stored, refKeys);
  assert.equal(view.active.environment, "harbor.png");
  assert.equal(view.active.audioReference, "wind.wav");
});

test("restoreModelSelection keeps saved model when listed and warns when missing", () => {
  const multi = ["model-a.gguf", "model-b.gguf", "model-c.gguf"];
  const ok = restoreModelSelection({ availableModels: multi, savedModel: "model-b.gguf", presetDefault: "model-a.gguf" });
  assert.equal(ok.model, "model-b.gguf");
  assert.equal(ok.restored, true);
  assert.equal(ok.warning, null);
  const missing = restoreModelSelection({ availableModels: multi, savedModel: "gone.gguf", presetDefault: "model-a.gguf" });
  assert.equal(missing.model, "model-a.gguf");
  assert.equal(missing.restored, false);
  assert.match(missing.warning, /non disponibile/);
});

test("initial baseline matches post-selectPreset form snapshot", () => {
  const before = projectEditorSnapshot({
    label: "",
    workflowId: "minimax-h3-fl2v",
    prompt: "",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1, model: "" },
    library: emptyLibrary(),
    files: {}
  });
  const afterInit = projectEditorSnapshot({
    label: "",
    workflowId: "minimax-h3-fl2v",
    prompt: "",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1, model: "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf" },
    library: emptyLibrary(),
    files: {}
  });
  // Capturing baseline before model init would look dirty; after init it must match itself.
  assert.equal(isProjectDirty(before, afterInit), true);
  assert.equal(isProjectDirty(afterInit, afterInit), false);
});

test("dirty state flips with prompt/settings/library and clears on matching snapshot", () => {
  const base = projectEditorSnapshot({
    label: "A",
    workflowId: "minimax-h3-i2v",
    prompt: "one",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1 },
    library: emptyLibrary(),
    files: {}
  });
  const dirty = projectEditorSnapshot({
    label: "A",
    workflowId: "minimax-h3-i2v",
    prompt: "two",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1 },
    library: emptyLibrary(),
    files: {}
  });
  assert.equal(isProjectDirty(base, dirty), true);
  assert.equal(isProjectDirty(base, base), false);
});

test("project store create update duplicate delete and malformed JSON safety", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-projects-"));
  const store = createProjectStore(dir);
  const created = await store.create({
    label: "Alpha",
    workflowId: "minimax-h3-i2v",
    prompt: "p",
    settings: { megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 1 },
    library: emptyLibrary(),
    files: {}
  });
  assert.equal(created.schemaVersion, 1);
  assert.ok(isValidProjectId(created.id));

  const updated = await store.update(created.id, {
    ...created,
    prompt: "updated",
    library: addGroup(emptyLibrary(), "objects", createGroup({
      label: "Radio",
      members: [createMember({ filename: "radio.png", originalName: "radio.png" })]
    }))
  });
  assert.equal(updated.prompt, "updated");
  assert.equal(updated.library.objects[0].label, "Radio");

  const dup = await store.duplicate(created.id, { label: "Alpha Copy" });
  assert.notEqual(dup.id, created.id);
  assert.equal(dup.label, "Alpha Copy");

  const conflictId = uniqueProjectId(created.id, [created.id, dup.id]);
  assert.notEqual(conflictId, created.id);

  await writeFile(path.join(dir, "broken.local.json"), "{not-json", "utf8");
  const listed = await store.list();
  assert.ok(listed.every(item => item.id !== "broken"));

  await store.remove(created.id);
  await assert.rejects(() => store.read(created.id), /not found/i);

  // Ensure we never wrote absolute directory paths into the JSON.
  const remaining = await readFile(path.join(dir, `${dup.id}.local.json`), "utf8");
  assert.equal(remaining.includes(dir.replaceAll("\\", "\\\\")), false);
  assert.ok(!remaining.includes("C:\\\\"));
});
