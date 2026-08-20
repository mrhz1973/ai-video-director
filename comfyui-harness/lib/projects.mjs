/** Local project schema, path safety, and categorized asset-library helpers (pure). */

import { lookupAvailability, normalizeInputSubfolder } from "./asset-ref.mjs";

export const SCHEMA_VERSION = 1;

export const CATEGORIES = ["elements", "locations", "objects", "audio"];
export const CATEGORY_LABELS = {
  elements: "Elements",
  locations: "Locations",
  objects: "Objects",
  audio: "Audio"
};

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
export const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidProjectId(id) {
  if (typeof id !== "string" || !id) return false;
  if (id.length > 80) return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes(":")) return false;
  if (id.startsWith("-") || id.endsWith("-")) return false;
  return ID_PATTERN.test(id);
}

export function assertValidProjectId(id) {
  if (!isValidProjectId(id)) throw new Error(`Invalid project id: ${id}`);
  return id;
}

export function slugifyLabel(label) {
  const base = String(label || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || `project-${Date.now().toString(36)}`;
}

export function projectFileName(id) {
  return `${assertValidProjectId(id)}.local.json`;
}

/** Node-only path resolver. */
export function resolveSafeProjectPathNode(pathMod, projectDirectory, id) {
  assertValidProjectId(id);
  const root = pathMod.resolve(projectDirectory);
  const target = pathMod.resolve(root, projectFileName(id));
  const rel = pathMod.relative(root, target);
  if (!rel || rel.startsWith("..") || pathMod.isAbsolute(rel)) {
    throw new Error("Project path escapes project directory");
  }
  if (!target.endsWith(".local.json")) throw new Error("Project filename must end with .local.json");
  return target;
}

export function newId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripExtension(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function extensionOf(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

export function isSupportedImageFile(fileLike = {}) {
  const type = String(fileLike.type || fileLike.mime || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  return IMAGE_EXTENSIONS.has(extensionOf(fileLike.name || fileLike.originalName || ""));
}

export function isSupportedAudioFile(fileLike = {}) {
  const type = String(fileLike.type || fileLike.mime || "").toLowerCase();
  if (type.startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.has(extensionOf(fileLike.name || fileLike.originalName || ""));
}

export function isFileAllowedForCategory(category, fileLike = {}) {
  if (category === "audio") return isSupportedAudioFile(fileLike);
  if (CATEGORIES.includes(category)) return isSupportedImageFile(fileLike);
  return false;
}

export function classifyDroppedFiles(category, fileList = []) {
  const accepted = [];
  const rejected = [];
  for (const file of fileList) {
    if (isFileAllowedForCategory(category, file)) accepted.push(file);
    else rejected.push({ name: file.name || "unknown", reason: "unsupported_type", category });
  }
  return { accepted, rejected };
}

export function assertSafeFilename(filename) {
  if (!filename || typeof filename !== "string") throw new Error("Filename required");
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Filename must be a ComfyUI input basename");
  }
  return filename;
}

export function createMember({ filename, originalName, label, type, id, subfolder } = {}) {
  const safe = assertSafeFilename(filename);
  const inferred = type || (AUDIO_EXTENSIONS.has(extensionOf(safe)) ? "audio" : "image");
  return {
    id: id || newId("member"),
    filename: safe,
    originalName: originalName || safe,
    label: label || stripExtension(originalName || safe) || safe,
    type: inferred,
    subfolder: (() => {
      const folder = normalizeInputSubfolder(subfolder);
      return folder == null ? "" : folder;
    })()
  };
}

/**
 * Display label for a group member. Ordinal follows current member order (first = #1).
 * Does not use the stored filename as primary text.
 */
export function formatMemberOrdinalLabel({ groupLabel, category, index, compact = false } = {}) {
  const n = Number(index);
  const ordinal = Number.isFinite(n) && n >= 0 ? n + 1 : 1;
  const cat = CATEGORY_LABELS[category] || "Asset";
  const numbered = `${cat} #${ordinal}`;
  const group = String(groupLabel || "").trim();
  if (compact || !group) return numbered;
  return `${group} · ${numbered}`;
}

export function memberSelectOption(member = {}) {
  return {
    value: member.filename,
    label: formatMemberOrdinalLabel({
      groupLabel: member.groupLabel,
      category: member.category,
      index: member.index
    }),
    title: member.originalName || member.filename || ""
  };
}

export function createGroup({ id, label, members = [] } = {}) {
  return {
    id: id || newId("group"),
    label: label || "Nuovo gruppo",
    members: (members || []).map(m => createMember(m)).filter(Boolean)
  };
}

export function emptyLibrary() {
  return { elements: [], locations: [], objects: [], audio: [] };
}

function normalizeLibrary(rawLibrary, legacyAssets, files) {
  const library = emptyLibrary();
  if (rawLibrary && typeof rawLibrary === "object") {
    for (const category of CATEGORIES) {
      const groups = Array.isArray(rawLibrary[category]) ? rawLibrary[category] : [];
      library[category] = groups
        .filter(g => g && typeof g === "object")
        .map(g => createGroup({
          id: g.id,
          label: g.label || "Gruppo",
          members: Array.isArray(g.members) ? g.members : []
        }));
    }
  }

  // Partial flat assets[] → elements groups (in-memory only).
  if ((!rawLibrary || !Object.keys(rawLibrary).length) && Array.isArray(legacyAssets) && legacyAssets.length) {
    for (const asset of legacyAssets) {
      if (!asset?.filename) continue;
      const category = CATEGORIES.includes(asset.category) ? asset.category : "elements";
      library[category].push(createGroup({
        id: asset.id || newId("group"),
        label: asset.label || stripExtension(asset.originalName || asset.filename),
        members: [createMember({
          id: asset.memberId || newId("member"),
          filename: asset.filename,
          originalName: asset.originalName || asset.filename,
          label: asset.label,
          type: asset.type
        })]
      }));
    }
  }

  // Legacy v0 files-only: promote each distinct filename into a single-member Elements group.
  const hasAnyGroup = CATEGORIES.some(cat => library[cat].length > 0);
  if (!hasAnyGroup && files && typeof files === "object") {
    const seen = new Set();
    for (const filename of Object.values(files)) {
      if (!filename || typeof filename !== "string" || seen.has(filename)) continue;
      seen.add(filename);
      const type = AUDIO_EXTENSIONS.has(extensionOf(filename)) ? "audio" : "image";
      const category = type === "audio" ? "audio" : "elements";
      library[category].push(createGroup({
        id: `legacy-${slugifyLabel(filename)}`,
        label: stripExtension(filename),
        members: [createMember({
          id: `legacy-member-${slugifyLabel(filename)}`,
          filename,
          originalName: filename,
          type
        })]
      }));
    }
  }

  return library;
}

function normalizeSettings(settings = {}) {
  const out = {};
  for (const key of ["megapixels", "steps", "duration", "aspect", "seed", "model", "quality"]) {
    if (settings[key] !== undefined && settings[key] !== null && settings[key] !== "") {
      out[key] = settings[key];
    }
  }
  return out;
}

export function normalizeProject(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const files = { ...(source.files || {}) };
  const library = normalizeLibrary(source.library, source.assets, files);
  const hadSchema = Number.isFinite(Number(source.schemaVersion));
  return {
    schemaVersion: SCHEMA_VERSION,
    id: source.id ? String(source.id) : "",
    label: source.label || source.id || "Untitled",
    workflowId: source.workflowId || "",
    prompt: source.prompt || "",
    settings: normalizeSettings(source.settings || {}),
    library,
    files,
    _legacySchemaVersion: hadSchema && Number(source.schemaVersion) === SCHEMA_VERSION ? SCHEMA_VERSION : 0
  };
}

export function toPersistedProject(project) {
  const normalized = normalizeProject(project);
  assertValidProjectId(normalized.id);
  const library = emptyLibrary();
  for (const category of CATEGORIES) {
    library[category] = (normalized.library[category] || []).map(group => ({
      id: group.id,
      label: group.label,
        members: (group.members || []).map(member => ({
        id: member.id,
        filename: member.filename,
        originalName: member.originalName,
        label: member.label,
        type: member.type,
        ...(member.subfolder ? { subfolder: member.subfolder } : {})
      }))
    }));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: normalized.id,
    label: normalized.label,
    workflowId: normalized.workflowId,
    prompt: normalized.prompt,
    settings: normalizeSettings(normalized.settings || {}),
    library,
    files: { ...(normalized.files || {}) }
  };
}

export function publicProjectView(project) {
  const normalized = normalizeProject(project);
  return {
    schemaVersion: normalized.schemaVersion,
    id: normalized.id,
    label: normalized.label,
    workflowId: normalized.workflowId,
    prompt: normalized.prompt,
    settings: normalized.settings,
    library: normalized.library,
    files: normalized.files
  };
}

export function projectEditorSnapshot({
  label,
  workflowId,
  prompt,
  settings,
  library,
  files
} = {}) {
  return JSON.stringify(toPersistedProject({
    id: "snapshot-temp-id",
    label,
    workflowId,
    prompt,
    settings,
    library,
    files
  }));
}

export function isProjectDirty(baselineSnapshot, currentSnapshot) {
  return String(baselineSnapshot || "") !== String(currentSnapshot || "");
}

export function listAllMembers(library = emptyLibrary()) {
  const members = [];
  for (const category of CATEGORIES) {
    for (const group of library[category] || []) {
      (group.members || []).forEach((member, index) => {
        members.push({ category, groupId: group.id, groupLabel: group.label, index, ...member });
      });
    }
  }
  return members;
}

export function findMember(library, memberId) {
  for (const category of CATEGORIES) {
    for (const group of library[category] || []) {
      const member = (group.members || []).find(m => m.id === memberId);
      if (member) return { category, group, member };
    }
  }
  return null;
}

export function findMemberByFilename(library, filename) {
  for (const category of CATEGORIES) {
    for (const group of library[category] || []) {
      const member = (group.members || []).find(m => m.filename === filename);
      if (member) return { category, group, member };
    }
  }
  return null;
}

export function addGroup(library, category, group) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  const next = structuredCloneLibrary(library);
  next[category] = [...(next[category] || []), createGroup(group)];
  return next;
}

export function renameGroup(library, category, groupId, label) {
  const next = structuredCloneLibrary(library);
  const group = (next[category] || []).find(g => g.id === groupId);
  if (!group) return next;
  group.label = String(label || group.label);
  return next;
}

export function removeGroup(library, category, groupId) {
  const next = structuredCloneLibrary(library);
  const group = (next[category] || []).find(g => g.id === groupId);
  const filenames = new Set((group?.members || []).map(m => m.filename));
  next[category] = (next[category] || []).filter(g => g.id !== groupId);
  return { library: next, removedFilenames: [...filenames] };
}

export function addMembersToGroup(library, category, groupId, members) {
  const next = structuredCloneLibrary(library);
  const group = (next[category] || []).find(g => g.id === groupId);
  if (!group) throw new Error("Group not found");
  group.members = [...(group.members || []), ...members.map(m => createMember(m))];
  return next;
}

export function removeMember(library, category, groupId, memberId) {
  const next = structuredCloneLibrary(library);
  const group = (next[category] || []).find(g => g.id === groupId);
  if (!group) return { library: next, removedFilename: null };
  const member = (group.members || []).find(m => m.id === memberId);
  group.members = (group.members || []).filter(m => m.id !== memberId);
  return { library: next, removedFilename: member?.filename || null };
}

export function reorderMembers(library, category, groupId, fromIndex, toIndex) {
  const next = structuredCloneLibrary(library);
  const group = (next[category] || []).find(g => g.id === groupId);
  if (!group) return next;
  const list = [...(group.members || [])];
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return next;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  group.members = list;
  return next;
}

function structuredCloneLibrary(library) {
  const src = library || emptyLibrary();
  const out = emptyLibrary();
  for (const category of CATEGORIES) {
    out[category] = (src[category] || []).map(g => createGroup(g));
  }
  return out;
}

export function clearRolesForFilenames(files, filenames = []) {
  const ban = new Set(filenames.filter(Boolean));
  const next = {};
  for (const [role, filename] of Object.entries(files || {})) {
    if (!ban.has(filename)) next[role] = filename;
  }
  return next;
}

export function assignRole(files, roleKey, filename) {
  const next = { ...(files || {}) };
  if (!roleKey) return next;
  if (!filename) {
    delete next[roleKey];
    return next;
  }
  next[roleKey] = assertSafeFilename(filename);
  return next;
}

export function retainCompatibleRoles(files, attachmentKeys = []) {
  const allowed = new Set(attachmentKeys);
  const next = {};
  for (const [key, value] of Object.entries(files || {})) {
    if (allowed.has(key) && value) next[key] = value;
  }
  return next;
}

/** Submission/view filter only — never use to mutate persisted draft.files. */
export function filterFilesForActivePreset(files, attachmentKeys = []) {
  return retainCompatibleRoles(files, attachmentKeys);
}

/**
 * Restore a saved model after the preset rebuilds the <select>.
 * Prefer the saved model when it is still listed; otherwise fall back and warn.
 */
export function restoreModelSelection({ availableModels = [], savedModel, presetDefault } = {}) {
  const models = (availableModels || []).filter(Boolean).map(String);
  const saved = savedModel == null || savedModel === "" ? undefined : String(savedModel);
  const fallback = presetDefault != null && presetDefault !== ""
    ? String(presetDefault)
    : (models[0] || "");
  if (!saved) {
    return { model: fallback, warning: null, restored: false };
  }
  if (models.includes(saved)) {
    return { model: saved, warning: null, restored: true };
  }
  return {
    model: fallback,
    warning: `Modello salvato non disponibile: ${saved}. Uso: ${fallback || "(nessuno)"}`,
    restored: false
  };
}

/**
 * Pure workflow-switch simulation: stored bindings must survive inactive presets.
 * activeFilesFor(workflowId) returns only roles declared by that workflow.
 */
export function simulateWorkflowBindingView(storedFiles, workflowAttachmentKeys) {
  return {
    stored: { ...(storedFiles || {}) },
    active: filterFilesForActivePreset(storedFiles, workflowAttachmentKeys)
  };
}

export function roleAcceptKind(accept = "") {
  const value = String(accept || "image/*").toLowerCase();
  if (value.includes("audio")) return "audio";
  if (value.includes("video")) return "video";
  return "image";
}

export function membersCompatibleWithRole(library, accept = "image/*") {
  const kind = roleAcceptKind(accept);
  return listAllMembers(library).filter(member => {
    if (kind === "audio") return member.type === "audio" || member.category === "audio";
    if (kind === "video") return member.type === "video";
    return member.type === "image" || member.category !== "audio";
  });
}

export function buildSubmissionFiles({
  files = {},
  library,
  availability = {},
  requiredKeys = [],
  activeKeys
} = {}) {
  const keys = Array.isArray(activeKeys) ? activeKeys : requiredKeys;
  const active = filterFilesForActivePreset(files, keys);
  const lib = library || emptyLibrary();
  const known = new Set(listAllMembers(lib).map(m => m.filename));
  const out = {};
  const missingRequired = [];
  for (const [role, filename] of Object.entries(active)) {
    if (!filename) continue;
    const found = findMemberByFilename(lib, filename);
    const status = lookupAvailability(availability, {
      filename,
      subfolder: found?.member?.subfolder || ""
    });
    const resolved = status === "unknown" && !known.has(filename) ? "missing" : status;
    if (resolved === "missing" || resolved === "error") {
      if (requiredKeys.includes(role)) missingRequired.push(role);
      continue;
    }
    out[role] = filename;
  }
  for (const role of requiredKeys) {
    if (!keys.includes(role)) continue;
    if (!out[role]) missingRequired.push(role);
  }
  return { files: out, missingRequired: [...new Set(missingRequired)] };
}

/**
 * Reasons the Generate button must stay disabled. Never submits a queue job.
 */
export function describeGenerateBlockers({
  prompt,
  attachments = [],
  files = {},
  library,
  availability = {},
  busy = false,
  submitting = false
} = {}) {
  if (busy || submitting) {
    return { blocked: true, reason: "Generazione in corso", code: "busy" };
  }
  if (!String(prompt || "").trim()) {
    return { blocked: true, reason: "Inserisci un prompt", code: "prompt" };
  }
  const activeKeys = (attachments || []).map(field => field.key).filter(Boolean);
  const built = buildSubmissionFiles({
    files,
    library,
    availability,
    activeKeys,
    requiredKeys: activeKeys
  });
  if (built.missingRequired.length) {
    const labels = built.missingRequired.map(key => {
      const field = (attachments || []).find(item => item.key === key);
      return field?.label || key;
    });
    return {
      blocked: true,
      reason: `Mancano o non sono disponibili: ${labels.join(", ")}`,
      code: "roles"
    };
  }
  return { blocked: false, reason: "", code: null };
}

export function uniqueProjectId(desiredId, existingIds = []) {
  const set = new Set(existingIds);
  let candidate = isValidProjectId(desiredId) ? desiredId : slugifyLabel(desiredId);
  if (!isValidProjectId(candidate)) candidate = slugifyLabel(candidate);
  if (!set.has(candidate)) return candidate;
  let n = 2;
  while (set.has(`${candidate}-${n}`)) n += 1;
  return `${candidate}-${n}`;
}

export function parseProjectJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Malformed project JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Malformed project JSON");
  }
  return normalizeProject(data);
}

/** Snapshot that deliberately excludes runtime/job fields. */
export function editorStateFromDomLike({
  label,
  workflowId,
  prompt,
  megapixels,
  model,
  steps,
  duration,
  aspect,
  seed,
  library,
  files
}) {
  return {
    label: label || "",
    workflowId: workflowId || "",
    prompt: prompt || "",
    settings: normalizeSettings({ megapixels, model, steps, duration, aspect, seed }),
    library: library || emptyLibrary(),
    files: { ...(files || {}) }
  };
}
