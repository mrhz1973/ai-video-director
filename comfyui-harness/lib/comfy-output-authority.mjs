/**
 * Authoritative Comfy output resolution for reveal/download (Issue #59).
 * Requires promptId + history match; then realpath containment under output root.
 */
import path from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";
import {
  ComfyOutputPathError,
  assertSafeOutputBasename,
  isMp4Filename,
  resolveSafeComfyOutputPath
} from "./comfy-output-path.mjs";
import { normalizeInputSubfolder } from "./asset-ref.mjs";

export function listHistoryOutputAssets(historyEntry) {
  const out = [];
  if (!historyEntry || typeof historyEntry !== "object") return out;
  for (const node of Object.values(historyEntry.outputs || {})) {
    for (const key of ["images", "animated", "videos", "audio"]) {
      for (const item of node?.[key] || []) {
        if (!item?.filename) continue;
        out.push({
          kind: key,
          filename: String(item.filename),
          subfolder: item.subfolder == null ? "" : String(item.subfolder),
          type: item.type || "output"
        });
      }
    }
  }
  return out;
}

export function findAuthoritativeHistoryOutput(historyEntry, {
  filename,
  subfolder = "",
  type = "output"
} = {}) {
  const safeName = assertSafeOutputBasename(filename);
  const folder = normalizeInputSubfolder(subfolder);
  if (folder == null) {
    throw new ComfyOutputPathError("Invalid subfolder.", { code: "unsafe-subfolder", status: 400 });
  }
  const wantType = String(type || "output");
  const match = listHistoryOutputAssets(historyEntry).find(item => (
    item.filename === safeName
    && (item.subfolder || "") === (folder || "")
    && String(item.type || "output") === wantType
  ));
  return match || null;
}

/**
 * Lexical resolve + filesystem realpath containment (blocks junction/symlink escape).
 */
export async function resolveContainedComfyOutputPath(outputRoot, meta, {
  realpathImpl = fsRealpath
} = {}) {
  const lexical = resolveSafeComfyOutputPath(outputRoot, meta);
  let realRoot;
  try {
    realRoot = await realpathImpl(lexical.root);
  } catch {
    throw new ComfyOutputPathError("Comfy output root is not accessible.", {
      code: "output-root-unconfigured",
      status: 503
    });
  }
  let realTarget;
  try {
    realTarget = await realpathImpl(lexical.absolutePath);
  } catch {
    throw new ComfyOutputPathError("Output file not found under Comfy output root.", {
      code: "file-not-found",
      status: 404
    });
  }
  const rel = path.relative(realRoot, realTarget);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ComfyOutputPathError("Path escapes Comfy output root.", {
      code: "root-escape",
      status: 400
    });
  }
  return {
    ...lexical,
    root: realRoot,
    absolutePath: realTarget
  };
}

/**
 * Fetch Comfy history and confirm the client tuple is an authoritative output of promptId.
 */
export async function resolveAuthoritativeComfyOutput({
  outputRoot,
  comfyUrl,
  promptId,
  filename,
  subfolder = "",
  type = "output",
  fetchFn = fetch,
  realpathImpl = fsRealpath
} = {}) {
  const id = String(promptId || "").trim();
  if (!id) {
    throw new ComfyOutputPathError("promptId is required.", {
      code: "prompt-id-required",
      status: 400
    });
  }
  const base = String(comfyUrl || "").replace(/\/$/, "");
  if (!base) {
    throw new ComfyOutputPathError("Comfy URL is not configured.", {
      code: "comfy-unavailable",
      status: 503
    });
  }

  let histRes;
  try {
    histRes = await fetchFn(`${base}/history/${encodeURIComponent(id)}`);
  } catch {
    throw new ComfyOutputPathError("Comfy history unreachable.", {
      code: "history-unavailable",
      status: 503
    });
  }
  if (!histRes?.ok) {
    throw new ComfyOutputPathError("Comfy history unavailable.", {
      code: "history-unavailable",
      status: 503
    });
  }
  let histData;
  try {
    histData = await histRes.json();
  } catch {
    throw new ComfyOutputPathError("Comfy history unavailable.", {
      code: "history-unavailable",
      status: 503
    });
  }
  const entry = histData?.[id];
  if (!entry) {
    throw new ComfyOutputPathError("Prompt history not found.", {
      code: "history-mismatch",
      status: 404
    });
  }
  const matched = findAuthoritativeHistoryOutput(entry, { filename, subfolder, type });
  if (!matched) {
    throw new ComfyOutputPathError("Output is not part of the authoritative prompt history.", {
      code: "history-mismatch",
      status: 403
    });
  }

  const contained = await resolveContainedComfyOutputPath(outputRoot, {
    filename: matched.filename,
    subfolder: matched.subfolder,
    type: matched.type
  }, { realpathImpl });

  return {
    ...contained,
    promptId: id,
    kind: matched.kind,
    type: matched.type
  };
}

export { isMp4Filename, ComfyOutputPathError };
