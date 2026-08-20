import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, copyFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SAFE_FIT_STATES,
  H3_SAFE_FIT_CONTRACT,
  coverCropRect,
  inspectH3SafeFit,
  applyH3SafeFit,
  safeFitBlocksGenerate,
  describeSafeFitBlocker,
  safeFitPreviewRoles,
  publicSafeFitSummary
} from "../lib/h3-safe-fit.mjs";
import {
  describeGenerateBlockers,
  SCHEMA_VERSION,
  normalizeProject,
  emptyLibrary,
  addGroup,
  createGroup,
  createMember
} from "../lib/projects.mjs";

const c = H3_SAFE_FIT_CONTRACT;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const patcher = path.join(repoRoot, "scripts", "apply_h3_safe_fit.mjs");

function loadImage(id) {
  return { class_type: c.loadClass, inputs: { image: `fixture-${id}.png` } };
}

function resolution() {
  return {
    class_type: c.resolutionClass,
    inputs: { aspect_ratio: "16:9 (Widescreen)", megapixels: 0.3, multiple: 32 }
  };
}

function resize(sourceId) {
  return {
    class_type: c.resizeClass,
    inputs: {
      resize_type: c.resizeType,
      "resize_type.width": [c.resolutionNodeId, 0],
      "resize_type.height": [c.resolutionNodeId, 1],
      "resize_type.crop": c.cropMode,
      scale_method: "nearest-exact",
      input: [sourceId, 0]
    }
  };
}

function makeI2VA({ firstFrom = c.firstLoadId } = {}) {
  return {
    [c.firstLoadId]: loadImage(c.firstLoadId),
    [c.resolutionNodeId]: resolution(),
    [c.firstResizeId]: resize(c.firstLoadId),
    // Orphans present in real I2VA exports; must not confuse inspector.
    [c.lastLoadId]: loadImage(c.lastLoadId),
    [c.lastResizeId]: resize(c.lastLoadId),
    [c.minimaxNodeId]: {
      class_type: c.minimaxClass,
      inputs: {
        prompt: "fixture",
        width: [c.resolutionNodeId, 0],
        height: [c.resolutionNodeId, 1],
        first_frame: [firstFrom, 0]
      }
    }
  };
}

function makeFL2VA({
  firstFrom = c.firstLoadId,
  lastFrom = c.lastLoadId
} = {}) {
  return {
    [c.firstLoadId]: loadImage(c.firstLoadId),
    [c.lastLoadId]: loadImage(c.lastLoadId),
    [c.resolutionNodeId]: resolution(),
    [c.firstResizeId]: resize(c.firstLoadId),
    [c.lastResizeId]: resize(c.lastLoadId),
    [c.minimaxNodeId]: {
      class_type: c.minimaxClass,
      inputs: {
        prompt: "fixture",
        width: [c.resolutionNodeId, 0],
        height: [c.resolutionNodeId, 1],
        first_frame: [firstFrom, 0],
        last_frame: [lastFrom, 0]
      }
    }
  };
}

function makeT2VA() {
  return {
    [c.resolutionNodeId]: resolution(),
    [c.minimaxNodeId]: {
      class_type: "ComfyMathExpression",
      inputs: { expression: "a", "values.a": 1 }
    }
  };
}

test("coverCropRect portrait 1024x1536 -> 16:9 is 1024x576 centered", () => {
  const crop = coverCropRect({
    sourceWidth: 1024,
    sourceHeight: 1536,
    targetWidth: 16,
    targetHeight: 9
  });
  assert.equal(crop.width, 1024);
  assert.equal(crop.height, 576);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, (1536 - 576) / 2);

  // ResolutionSelector may emit near-16:9 pixels (e.g. 736×416); crop stays center COVER.
  const near = coverCropRect({
    sourceWidth: 1024,
    sourceHeight: 1536,
    targetWidth: 736,
    targetHeight: 416
  });
  assert.equal(near.width, 1024);
  assert.ok(Math.abs(near.height - 576) < 3);
  assert.equal(near.x, 0);
  assert.ok(Math.abs(near.y - (1536 - near.height) / 2) < 1e-9);
});

test("coverCropRect landscape identity and square/portrait targets", () => {
  const identity = coverCropRect({
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetWidth: 16,
    targetHeight: 9
  });
  assert.equal(identity.width, 1920);
  assert.equal(identity.height, 1080);
  assert.equal(identity.x, 0);
  assert.equal(identity.y, 0);

  const landscapeKeep = coverCropRect({
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetWidth: 1280,
    targetHeight: 720
  });
  assert.equal(landscapeKeep.width, 1920);
  assert.equal(landscapeKeep.height, 1080);

  const toPortrait = coverCropRect({
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetWidth: 9,
    targetHeight: 16
  });
  assert.equal(toPortrait.height, 1080);
  assert.equal(toPortrait.width, 1080 * 9 / 16);
  assert.ok(toPortrait.x > 0);

  const square = coverCropRect({
    sourceWidth: 1000,
    sourceHeight: 1000,
    targetWidth: 16,
    targetHeight: 9
  });
  assert.equal(square.width, 1000);
  assert.equal(square.height, 1000 * 9 / 16);
  assert.equal(square.x, 0);
  assert.ok(square.y > 0);
});

test("inspector: I2VA legacy/safe and FL2VA legacy/safe", () => {
  assert.equal(inspectH3SafeFit(makeI2VA(), { mode: "I2VA" }).status, SAFE_FIT_STATES.NEEDS_APPLY);
  assert.equal(
    inspectH3SafeFit(makeI2VA({ firstFrom: c.firstResizeId }), { mode: "I2VA" }).status,
    SAFE_FIT_STATES.SAFE
  );
  assert.equal(inspectH3SafeFit(makeFL2VA(), { mode: "FL2VA" }).status, SAFE_FIT_STATES.NEEDS_APPLY);
  assert.equal(
    inspectH3SafeFit(
      makeFL2VA({ firstFrom: c.firstResizeId, lastFrom: c.lastResizeId }),
      { mode: "FL2VA" }
    ).status,
    SAFE_FIT_STATES.SAFE
  );
});

test("inspector: T2VA/Ref2VA not-applicable; unexpected links fail closed", () => {
  assert.equal(inspectH3SafeFit(makeT2VA(), { mode: "T2VA" }).status, SAFE_FIT_STATES.NOT_APPLICABLE);
  assert.equal(inspectH3SafeFit({}, { mode: "REF2VA" }).status, SAFE_FIT_STATES.NOT_APPLICABLE);
  const weird = makeI2VA({ firstFrom: "999" });
  assert.equal(inspectH3SafeFit(weird, { mode: "I2VA" }).status, SAFE_FIT_STATES.UNEXPECTED);
  const mixed = makeFL2VA({ firstFrom: c.firstResizeId, lastFrom: c.lastLoadId });
  assert.equal(inspectH3SafeFit(mixed, { mode: "FL2VA" }).status, SAFE_FIT_STATES.UNEXPECTED);
});

test("applyH3SafeFit patches only expected links and is idempotent", () => {
  const i2v = makeI2VA();
  const patched = applyH3SafeFit(i2v, { mode: "I2VA" });
  assert.equal(patched.changed, true);
  assert.deepEqual(patched.workflow[c.minimaxNodeId].inputs.first_frame, [c.firstResizeId, 0]);
  assert.equal(patched.workflow[c.minimaxNodeId].inputs.prompt, "fixture");
  assert.deepEqual(i2v[c.minimaxNodeId].inputs.first_frame, [c.firstLoadId, 0]);

  const again = applyH3SafeFit(patched.workflow, { mode: "I2VA" });
  assert.equal(again.changed, false);
  assert.equal(again.alreadySafe, true);

  const fl = applyH3SafeFit(makeFL2VA(), { mode: "FL2VA" });
  assert.deepEqual(fl.workflow[c.minimaxNodeId].inputs.first_frame, [c.firstResizeId, 0]);
  assert.deepEqual(fl.workflow[c.minimaxNodeId].inputs.last_frame, [c.lastResizeId, 0]);
});

test("apply aborts on wrong crop / class / missing nodes", () => {
  const badCrop = makeI2VA();
  badCrop[c.firstResizeId].inputs["resize_type.crop"] = "disabled";
  assert.throws(() => applyH3SafeFit(badCrop, { mode: "I2VA" }), /Refusing|unexpected/i);

  const badClass = makeI2VA();
  badClass[c.minimaxNodeId].class_type = "SomethingElse";
  assert.throws(() => applyH3SafeFit(badClass, { mode: "I2VA" }), /Refusing|unexpected/i);

  const missing = makeI2VA();
  delete missing[c.firstResizeId];
  assert.throws(() => applyH3SafeFit(missing, { mode: "I2VA" }), /Refusing|unexpected/i);
});

test("Generate blockers honor safe-fit while T2VA/Ref2VA stay unaffected", () => {
  const attachments = [{ key: "firstImage", label: "Immagine iniziale", accept: "image/*" }];
  const library = addGroup(emptyLibrary(), "elements", createGroup({
    label: "Fixture",
    members: [createMember({ filename: "face.png", originalName: "face.png" })]
  }));
  const base = {
    prompt: "ok",
    attachments,
    files: { firstImage: "face.png" },
    library,
    availability: { "face.png": "available" }
  };
  assert.equal(describeGenerateBlockers({ ...base, safeFitStatus: "safe" }).blocked, false);
  assert.equal(describeGenerateBlockers({ ...base, safeFitStatus: "needs-apply" }).code, "safe-fit");
  assert.equal(describeGenerateBlockers({ ...base, safeFitStatus: "unexpected" }).code, "safe-fit");
  assert.equal(
    describeGenerateBlockers({
      prompt: "ok",
      attachments: [],
      files: {},
      library: emptyLibrary(),
      availability: {},
      safeFitStatus: "not-applicable"
    }).blocked,
    false
  );
  assert.equal(safeFitBlocksGenerate("needs-apply"), true);
  assert.equal(describeSafeFitBlocker("needs-apply").reason.includes("non aggiornato"), true);
  assert.deepEqual(safeFitPreviewRoles("I2VA"), ["firstImage"]);
  assert.deepEqual(safeFitPreviewRoles("FL2VA"), ["firstImage", "lastImage"]);
  assert.deepEqual(safeFitPreviewRoles("T2VA"), []);
  assert.equal(publicSafeFitSummary({ status: "safe", mode: "I2VA" }).blocksGenerate, false);
});

test("schemaVersion 1 and filename bindings remain compatible", () => {
  const legacy = {
    id: "safe-fit-compat",
    label: "Compat",
    workflowId: "minimax-h3-i2v",
    prompt: "p",
    files: { firstImage: "face.png" }
  };
  const normalized = normalizeProject(legacy);
  assert.equal(normalized.schemaVersion, SCHEMA_VERSION);
  assert.equal(normalized.files.firstImage, "face.png");
});

async function runPatcher(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [patcher, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString("utf8"); });
    child.stderr.on("data", d => { stderr += d.toString("utf8"); });
    child.on("exit", code => resolve({ code, stdout, stderr }));
    child.on("error", reject);
  });
}

test("CLI patcher check/apply/idempotence/backup on temp copies", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-safe-fit-"));
  const i2vPath = path.join(tmp, "i2v.api.json");
  const fl2vPath = path.join(tmp, "fl2v.api.json");
  await writeFile(i2vPath, `${JSON.stringify(makeI2VA(), null, 2)}\n`);
  await writeFile(fl2vPath, `${JSON.stringify(makeFL2VA(), null, 2)}\n`);
  const beforeI2v = await readFile(i2vPath);
  const beforeFl = await readFile(fl2vPath);

  const check = await runPatcher(["--check", "--i2v", i2vPath, "--fl2v", fl2vPath]);
  assert.equal(check.code, 0);
  assert.match(check.stdout, /needs-apply/);

  const apply = await runPatcher(["--apply", "--i2v", i2vPath, "--fl2v", fl2vPath]);
  assert.equal(apply.code, 0, apply.stderr);
  assert.match(apply.stdout, /APPLIED/);

  const afterI2v = JSON.parse(await readFile(i2vPath, "utf8"));
  const afterFl = JSON.parse(await readFile(fl2vPath, "utf8"));
  assert.deepEqual(afterI2v[c.minimaxNodeId].inputs.first_frame, [c.firstResizeId, 0]);
  assert.deepEqual(afterFl[c.minimaxNodeId].inputs.first_frame, [c.firstResizeId, 0]);
  assert.deepEqual(afterFl[c.minimaxNodeId].inputs.last_frame, [c.lastResizeId, 0]);

  const bakI2v = `${i2vPath}.pre-safe-fit.bak`;
  const bakFl = `${fl2vPath}.pre-safe-fit.bak`;
  await access(bakI2v, fsConstants.F_OK);
  await access(bakFl, fsConstants.F_OK);
  assert.equal(Buffer.compare(await readFile(bakI2v), beforeI2v), 0);
  assert.equal(Buffer.compare(await readFile(bakFl), beforeFl), 0);

  const again = await runPatcher(["--apply", "--i2v", i2vPath, "--fl2v", fl2vPath]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /ALREADY_SAFE/);

  const checkSafe = await runPatcher(["--check", "--i2v", i2vPath, "--fl2v", fl2vPath]);
  assert.equal(checkSafe.code, 0);
  assert.match(checkSafe.stdout, /status=safe/);

  // Failed validation must not write.
  const badPath = path.join(tmp, "bad.api.json");
  const bad = makeI2VA();
  bad[c.firstResizeId].inputs["resize_type.crop"] = "disabled";
  await writeFile(badPath, `${JSON.stringify(bad, null, 2)}\n`);
  const beforeBad = await readFile(badPath);
  const fail = await runPatcher(["--apply", "--i2v", badPath]);
  assert.notEqual(fail.code, 0);
  assert.equal(Buffer.compare(await readFile(badPath), beforeBad), 0);
});

test("CLI usage without check/apply exits non-zero", async () => {
  const result = await runPatcher(["--i2v", "x.json"]);
  assert.notEqual(result.code, 0);
});
