/**
 * MiniMax H3 I2VA / FL2VA safe center-crop image-fit contracts.
 *
 * Private API workflows are local-only. This module encodes the public graph
 * contracts so another machine can inspect / patch without committing private JSON.
 *
 * Bug: MiniMaxH3ImageToVideo first_frame/last_frame linked directly to LoadImage
 * stretch non-uniformly to ResolutionSelector WxH. Safe path: ResizeImageMaskNode
 * with center crop to 115 width/height, then feed MiniMax.
 */

export const SAFE_FIT_STATES = Object.freeze({
  NOT_APPLICABLE: "not-applicable",
  SAFE: "safe",
  NEEDS_APPLY: "needs-apply",
  UNEXPECTED: "unexpected"
});

export const H3_SAFE_FIT_CONTRACT = Object.freeze({
  resolutionNodeId: "115",
  resolutionClass: "ResolutionSelector",
  firstLoadId: "114",
  lastLoadId: "141",
  firstResizeId: "144",
  lastResizeId: "142",
  minimaxNodeId: "133",
  loadClass: "LoadImage",
  resizeClass: "ResizeImageMaskNode",
  minimaxClass: "MiniMaxH3ImageToVideo",
  resizeType: "scale dimensions",
  cropMode: "center"
});

export function coverCropRect({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight
} = {}) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const tw = Number(targetWidth);
  const th = Number(targetHeight);
  if (![sw, sh, tw, th].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error("coverCropRect requires positive finite dimensions");
  }
  const sourceAspect = sw / sh;
  const targetAspect = tw / th;
  let cropWidth;
  let cropHeight;
  if (sourceAspect > targetAspect) {
    // Source wider than target: crop width.
    cropHeight = sh;
    cropWidth = sh * targetAspect;
  } else {
    // Source taller (or equal): crop height.
    cropWidth = sw;
    cropHeight = sw / targetAspect;
  }
  const x = (sw - cropWidth) / 2;
  const y = (sh - cropHeight) / 2;
  return {
    x,
    y,
    width: cropWidth,
    height: cropHeight,
    sourceWidth: sw,
    sourceHeight: sh,
    targetWidth: tw,
    targetHeight: th,
    targetAspect
  };
}

export function linkNodeId(value) {
  if (Array.isArray(value) && value.length >= 1) return String(value[0]);
  return null;
}

export function isLinkTo(value, nodeId, outputIndex = 0) {
  if (!Array.isArray(value) || value.length < 2) return false;
  return String(value[0]) === String(nodeId) && Number(value[1]) === Number(outputIndex);
}

function nodeOf(workflow, id) {
  return workflow?.[String(id)] || null;
}

function classOf(workflow, id) {
  return nodeOf(workflow, id)?.class_type || null;
}

export function detectH3ImageFitMode(workflow = {}, hintMode = "") {
  const hint = String(hintMode || "").toUpperCase();
  if (hint === "T2VA" || hint === "REF2VA" || hint === "REFERENCE") {
    return SAFE_FIT_STATES.NOT_APPLICABLE;
  }
  const minimax = nodeOf(workflow, H3_SAFE_FIT_CONTRACT.minimaxNodeId);
  if (!minimax || minimax.class_type !== H3_SAFE_FIT_CONTRACT.minimaxClass) {
    return SAFE_FIT_STATES.NOT_APPLICABLE;
  }
  const hasLast = Object.prototype.hasOwnProperty.call(minimax.inputs || {}, "last_frame");
  if (hint === "FL2VA" || hasLast) return "FL2VA";
  if (hint === "I2VA" || Object.prototype.hasOwnProperty.call(minimax.inputs || {}, "first_frame")) {
    return "I2VA";
  }
  return SAFE_FIT_STATES.NOT_APPLICABLE;
}

export function validateCenterResizeNode(workflow, resizeId, expectedSourceId) {
  const c = H3_SAFE_FIT_CONTRACT;
  const node = nodeOf(workflow, resizeId);
  if (!node) return { ok: false, reason: `missing_resize_${resizeId}` };
  if (node.class_type !== c.resizeClass) {
    return { ok: false, reason: `wrong_class_${resizeId}` };
  }
  const inputs = node.inputs || {};
  if (inputs.resize_type !== c.resizeType) {
    return { ok: false, reason: `wrong_resize_type_${resizeId}` };
  }
  if (String(inputs["resize_type.crop"] || "") !== c.cropMode) {
    return { ok: false, reason: `wrong_crop_${resizeId}` };
  }
  if (!isLinkTo(inputs["resize_type.width"], c.resolutionNodeId, 0)) {
    return { ok: false, reason: `wrong_width_link_${resizeId}` };
  }
  if (!isLinkTo(inputs["resize_type.height"], c.resolutionNodeId, 1)) {
    return { ok: false, reason: `wrong_height_link_${resizeId}` };
  }
  if (!isLinkTo(inputs.input, expectedSourceId, 0)) {
    return { ok: false, reason: `wrong_input_link_${resizeId}` };
  }
  return { ok: true, reason: null };
}

export function validateSharedResolution(workflow) {
  const c = H3_SAFE_FIT_CONTRACT;
  if (classOf(workflow, c.resolutionNodeId) !== c.resolutionClass) {
    return { ok: false, reason: "wrong_resolution_class" };
  }
  return { ok: true, reason: null };
}

/**
 * Inspect a loaded H3 API workflow. Returns safe-fit status + details.
 * @param {object} workflow
 * @param {{ mode?: string }} [options] optional preset mode hint (I2VA/FL2VA/T2VA/…)
 */
export function inspectH3SafeFit(workflow = {}, options = {}) {
  const hint = String(options.mode || "").toUpperCase();
  if (hint === "T2VA" || hint === "REF2VA" || hint === "REFERENCE") {
    return {
      status: SAFE_FIT_STATES.NOT_APPLICABLE,
      mode: hint === "REFERENCE" ? "REF2VA" : hint,
      reason: "mode_not_applicable",
      details: {}
    };
  }

  const c = H3_SAFE_FIT_CONTRACT;
  const minimax = nodeOf(workflow, c.minimaxNodeId);
  if (!minimax || minimax.class_type !== c.minimaxClass) {
    if (hint === "I2VA" || hint === "FL2VA") {
      return {
        status: SAFE_FIT_STATES.UNEXPECTED,
        mode: hint,
        reason: "missing_or_wrong_minimax_node",
        details: { class_type: minimax?.class_type || null }
      };
    }
    return {
      status: SAFE_FIT_STATES.NOT_APPLICABLE,
      mode: null,
      reason: "no_minimax_image_to_video",
      details: {}
    };
  }

  const hasLast = Object.prototype.hasOwnProperty.call(minimax.inputs || {}, "last_frame");
  const mode = hint === "FL2VA" || hasLast ? "FL2VA" : "I2VA";
  const first = linkNodeId(minimax.inputs?.first_frame);
  const last = hasLast ? linkNodeId(minimax.inputs?.last_frame) : null;

  const res = validateSharedResolution(workflow);
  if (!res.ok) {
    return { status: SAFE_FIT_STATES.UNEXPECTED, mode, reason: res.reason, details: { first, last } };
  }
  if (classOf(workflow, c.firstLoadId) !== c.loadClass) {
    return {
      status: SAFE_FIT_STATES.UNEXPECTED,
      mode,
      reason: "wrong_first_load_class",
      details: { first, last }
    };
  }
  const firstResize = validateCenterResizeNode(workflow, c.firstResizeId, c.firstLoadId);
  if (!firstResize.ok) {
    return {
      status: SAFE_FIT_STATES.UNEXPECTED,
      mode,
      reason: firstResize.reason,
      details: { first, last }
    };
  }

  if (mode === "I2VA") {
    if (isLinkTo(minimax.inputs?.first_frame, c.firstResizeId, 0)) {
      return {
        status: SAFE_FIT_STATES.SAFE,
        mode,
        reason: "first_frame_via_center_resize",
        details: { first, last: null }
      };
    }
    if (isLinkTo(minimax.inputs?.first_frame, c.firstLoadId, 0)) {
      return {
        status: SAFE_FIT_STATES.NEEDS_APPLY,
        mode,
        reason: "legacy_direct_first_frame",
        details: { first, last: null }
      };
    }
    return {
      status: SAFE_FIT_STATES.UNEXPECTED,
      mode,
      reason: "unexpected_first_frame_link",
      details: { first, last: null }
    };
  }

  // FL2VA
  if (classOf(workflow, c.lastLoadId) !== c.loadClass) {
    return {
      status: SAFE_FIT_STATES.UNEXPECTED,
      mode,
      reason: "wrong_last_load_class",
      details: { first, last }
    };
  }
  const lastResize = validateCenterResizeNode(workflow, c.lastResizeId, c.lastLoadId);
  if (!lastResize.ok) {
    return {
      status: SAFE_FIT_STATES.UNEXPECTED,
      mode,
      reason: lastResize.reason,
      details: { first, last }
    };
  }

  const firstSafe = isLinkTo(minimax.inputs?.first_frame, c.firstResizeId, 0);
  const firstLegacy = isLinkTo(minimax.inputs?.first_frame, c.firstLoadId, 0);
  const lastSafe = isLinkTo(minimax.inputs?.last_frame, c.lastResizeId, 0);
  const lastLegacy = isLinkTo(minimax.inputs?.last_frame, c.lastLoadId, 0);

  if (firstSafe && lastSafe) {
    return {
      status: SAFE_FIT_STATES.SAFE,
      mode,
      reason: "first_last_via_center_resize",
      details: { first, last }
    };
  }
  if (firstLegacy && lastLegacy) {
    return {
      status: SAFE_FIT_STATES.NEEDS_APPLY,
      mode,
      reason: "legacy_direct_first_last_frames",
      details: { first, last }
    };
  }
  // Partially patched / mixed is unexpected — fail closed.
  return {
    status: SAFE_FIT_STATES.UNEXPECTED,
    mode,
    reason: "unexpected_or_mixed_frame_links",
    details: { first, last, firstSafe, firstLegacy, lastSafe, lastLegacy }
  };
}

/**
 * Apply only the allowed semantic rewires. Returns { changed, workflow, report }.
 * Throws on unexpected topology.
 */
export function applyH3SafeFit(workflow, options = {}) {
  const inspection = inspectH3SafeFit(workflow, options);
  if (inspection.status === SAFE_FIT_STATES.NOT_APPLICABLE) {
    return { changed: false, workflow, report: inspection, alreadySafe: false };
  }
  if (inspection.status === SAFE_FIT_STATES.SAFE) {
    return { changed: false, workflow, report: inspection, alreadySafe: true };
  }
  if (inspection.status !== SAFE_FIT_STATES.NEEDS_APPLY) {
    const err = new Error(`Refusing to patch unsafe/unexpected topology: ${inspection.reason}`);
    err.code = "UNEXPECTED_TOPOLOGY";
    err.inspection = inspection;
    throw err;
  }

  const next = structuredClone(workflow);
  const c = H3_SAFE_FIT_CONTRACT;
  const minimax = next[c.minimaxNodeId];
  if (inspection.mode === "I2VA") {
    minimax.inputs.first_frame = [c.firstResizeId, 0];
  } else if (inspection.mode === "FL2VA") {
    minimax.inputs.first_frame = [c.firstResizeId, 0];
    minimax.inputs.last_frame = [c.lastResizeId, 0];
  } else {
    throw new Error(`Unsupported mode for apply: ${inspection.mode}`);
  }

  const after = inspectH3SafeFit(next, { mode: inspection.mode });
  if (after.status !== SAFE_FIT_STATES.SAFE) {
    const err = new Error(`Patch did not reach SAFE state: ${after.reason}`);
    err.code = "PATCH_VERIFY_FAILED";
    err.inspection = after;
    throw err;
  }
  return {
    changed: true,
    workflow: next,
    report: after,
    alreadySafe: false,
    before: inspection
  };
}

export function safeFitBlocksGenerate(status) {
  return status === SAFE_FIT_STATES.NEEDS_APPLY || status === SAFE_FIT_STATES.UNEXPECTED;
}

export function describeSafeFitBlocker(status) {
  if (status === SAFE_FIT_STATES.NEEDS_APPLY) {
    return {
      blocked: true,
      reason: "Workflow image-fit non aggiornato",
      code: "safe-fit"
    };
  }
  if (status === SAFE_FIT_STATES.UNEXPECTED) {
    return {
      blocked: true,
      reason: "Workflow image-fit non valido",
      code: "safe-fit"
    };
  }
  return { blocked: false, reason: "", code: null };
}

/** Roles that receive a center-cover crop preview when workflow is SAFE. */
export function safeFitPreviewRoles(mode) {
  const m = String(mode || "").toUpperCase();
  if (m === "I2VA") return ["firstImage"];
  if (m === "FL2VA") return ["firstImage", "lastImage"];
  return [];
}

export function publicSafeFitSummary(inspection = {}) {
  return {
    status: inspection.status || SAFE_FIT_STATES.NOT_APPLICABLE,
    mode: inspection.mode || null,
    reason: inspection.reason || null,
    blocksGenerate: safeFitBlocksGenerate(inspection.status)
  };
}
