/**
 * OUTPUT list/gallery prefs + authoritative filter/group/order (Issue #92).
 * Browser-local only — never mutates clip files or project data.
 */

export const OUTPUT_VIEW_MODES = Object.freeze(["gallery", "list"]);
export const OUTPUT_GROUP_BY = Object.freeze(["none", "workflow", "source", "session"]);
export const OUTPUT_ORDER_BY = Object.freeze(["newest", "oldest", "workflow", "label"]);
export const OUTPUT_VIEW_STORAGE_KEY = "h3OutputViewPrefs:v1";

export function normalizeOutputViewMode(value) {
  const next = String(value || "").trim().toLowerCase();
  return OUTPUT_VIEW_MODES.includes(next) ? next : "gallery";
}

export function normalizeOutputGroupBy(value) {
  const next = String(value || "").trim().toLowerCase();
  return OUTPUT_GROUP_BY.includes(next) ? next : "none";
}

export function normalizeOutputOrderBy(value) {
  const next = String(value || "").trim().toLowerCase();
  return OUTPUT_ORDER_BY.includes(next) ? next : "newest";
}

export function defaultOutputViewPrefs() {
  return {
    mode: "gallery",
    groupBy: "none",
    orderBy: "newest",
    workflowFilter: "",
    sourceFilter: ""
  };
}

export function normalizeOutputViewPrefs(raw = {}) {
  const base = defaultOutputViewPrefs();
  return {
    mode: normalizeOutputViewMode(raw.mode ?? base.mode),
    groupBy: normalizeOutputGroupBy(raw.groupBy ?? base.groupBy),
    orderBy: normalizeOutputOrderBy(raw.orderBy ?? base.orderBy),
    workflowFilter: String(raw.workflowFilter || "").trim(),
    sourceFilter: String(raw.sourceFilter || "").trim().toLowerCase()
  };
}

export function readOutputViewPrefs(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(OUTPUT_VIEW_STORAGE_KEY);
    if (!raw) return defaultOutputViewPrefs();
    return normalizeOutputViewPrefs(JSON.parse(raw));
  } catch {
    return defaultOutputViewPrefs();
  }
}

export function persistOutputViewPrefs(prefs, storage = globalThis.localStorage) {
  const next = normalizeOutputViewPrefs(prefs);
  try { storage?.setItem?.(OUTPUT_VIEW_STORAGE_KEY, JSON.stringify(next)); } catch { /* browser-local */ }
  return next;
}

function clipTime(clip) {
  const t = Date.parse(clip?.completedAt || "");
  return Number.isFinite(t) ? t : 0;
}

function clipLabel(clip) {
  return String(clip?.jobLabel || clip?.filename || clip?.id || "").toLowerCase();
}

export function filterSessionClips(clips, prefs) {
  const list = Array.isArray(clips) ? clips : [];
  const p = normalizeOutputViewPrefs(prefs);
  return list.filter(clip => {
    if (p.workflowFilter) {
      const wf = String(clip?.workflowId || clip?.workflowLabel || "");
      if (wf !== p.workflowFilter && String(clip?.workflowLabel || "") !== p.workflowFilter) {
        return false;
      }
    }
    if (p.sourceFilter) {
      if (String(clip?.source || "").toLowerCase() !== p.sourceFilter) return false;
    }
    return true;
  });
}

export function sortSessionClips(clips, orderBy) {
  const list = [...(Array.isArray(clips) ? clips : [])];
  const order = normalizeOutputOrderBy(orderBy);
  list.sort((a, b) => {
    if (order === "oldest") return clipTime(a) - clipTime(b);
    if (order === "workflow") {
      const aw = String(a?.workflowLabel || a?.workflowId || "");
      const bw = String(b?.workflowLabel || b?.workflowId || "");
      return aw.localeCompare(bw, "it") || clipTime(b) - clipTime(a);
    }
    if (order === "label") {
      return clipLabel(a).localeCompare(clipLabel(b), "it") || clipTime(b) - clipTime(a);
    }
    // newest
    return clipTime(b) - clipTime(a);
  });
  return list;
}

export function groupSessionClips(clips, groupBy) {
  const list = Array.isArray(clips) ? clips : [];
  const g = normalizeOutputGroupBy(groupBy);
  if (g === "none") {
    return [{ key: "all", label: "Clip", items: list }];
  }
  const map = new Map();
  for (const clip of list) {
    let key = "unknown";
    let label = "Altro";
    if (g === "workflow") {
      key = String(clip?.workflowId || clip?.workflowLabel || "unknown");
      label = String(clip?.workflowLabel || clip?.workflowId || "Workflow sconosciuto");
    } else if (g === "source") {
      key = String(clip?.source || "unknown").toLowerCase();
      label = key === "batch" ? "Batch" : key === "single" ? "Singolo" : key;
    } else if (g === "session") {
      key = String(clip?.queueEntryId || clip?.queueBatchName || "session-local");
      label = String(clip?.queueBatchName || (clip?.queueEntryId ? `Coda ${clip.queueEntryId}` : "Sessione corrente"));
    }
    if (!map.has(key)) map.set(key, { key, label, items: [] });
    map.get(key).items.push(clip);
  }
  return [...map.values()];
}

export function prepareSessionClipsView(clips, prefs) {
  const p = normalizeOutputViewPrefs(prefs);
  const filtered = filterSessionClips(clips, p);
  const sorted = sortSessionClips(filtered, p.orderBy);
  const groups = groupSessionClips(sorted, p.groupBy);
  return { prefs: p, filtered: sorted, groups, empty: sorted.length === 0 };
}

export function collectWorkflowFilterOptions(clips) {
  const seen = new Map();
  for (const clip of Array.isArray(clips) ? clips : []) {
    const id = String(clip?.workflowId || "").trim();
    const label = String(clip?.workflowLabel || id || "").trim();
    if (!id && !label) continue;
    const key = id || label;
    if (!seen.has(key)) seen.set(key, label || id);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}
