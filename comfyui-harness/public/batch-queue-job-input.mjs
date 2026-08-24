/**
 * Human-readable input-role editors for future queued Batch jobs (Issue #59).
 * item.files override → else source.files; no raw JSON in normal UI.
 */
import { normalizeItemFiles, resolveBatchItemFiles } from "../lib/batch-draft.mjs";
import { memberSelectOption, membersCompatibleWithRole, roleAcceptKind } from "../lib/projects.mjs";
import { resolveEffectiveFirstFrame } from "./first-frame-view.mjs";

export function resolveQueueAttachmentRoles(source = {}) {
  if (Array.isArray(source?.attachmentRoles) && source.attachmentRoles.length) {
    return source.attachmentRoles.filter(role => role?.key && roleAcceptKind(role.accept) !== "video");
  }
  return (source?.requiredKeys || []).map(key => ({ key, label: key, accept: "image/*" }));
}

/** Set or clear a per-job file override; empty value removes the override key. */
export function setQueueItemFileOverride(itemFiles, roleKey, value) {
  const next = { ...(normalizeItemFiles(itemFiles) || {}) };
  const trimmed = String(value || "").trim();
  if (!trimmed) delete next[roleKey];
  else next[roleKey] = trimmed;
  return normalizeItemFiles(next);
}

/** Merge editable draft fields onto the persisted queue job item for update-entry. */
export function buildSavedQueueJobItem(jobItem, draftItem) {
  const out = { ...jobItem };
  for (const field of ["prompt", "seed", "duration", "steps", "megapixels", "aspect"]) {
    if (Object.prototype.hasOwnProperty.call(draftItem, field)) {
      out[field] = draftItem[field];
    }
  }
  if (Object.prototype.hasOwnProperty.call(draftItem, "files")) {
    const files = normalizeItemFiles(draftItem.files);
    if (files) out.files = files;
    else delete out.files;
  }
  return out;
}

export function cloneQueueJobDraft(item = {}) {
  const draftItem = { ...item };
  const files = normalizeItemFiles(item.files);
  if (files) draftItem.files = { ...files };
  else delete draftItem.files;
  return draftItem;
}

export function resolveQueueJobEffectiveRoleFilename({
  source = {},
  item = {},
  library = null,
  availability = null,
  roleKey = "firstImage"
} = {}) {
  return resolveEffectiveFirstFrame({
    itemFiles: item.files,
    sharedFiles: source.files,
    library,
    availability,
    roleKey
  }).filename;
}

/**
 * Append role selectors for a queued job editor body.
 * @param {Document} documentRef
 */
export function appendQueueJobInputSection(documentRef, body, {
  source = {},
  item = {},
  library = null,
  draftItem = {},
  availability = null,
  onDraftChange = null
} = {}) {
  const roles = resolveQueueAttachmentRoles(source);
  if (!roles.length || !documentRef || !body) return;

  const sharedFiles = source?.files && typeof source.files === "object" ? source.files : {};
  const section = documentRef.createElement("div");
  section.className = "batch-queue-job-inputs";
  const heading = documentRef.createElement("div");
  heading.className = "batch-queue-job-inputs-label";
  heading.textContent = "Input";
  section.append(heading);

  for (const role of roles) {
    const overrides = normalizeItemFiles(draftItem.files) || {};
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, role.key);
    const sharedName = sharedFiles[role.key] || "";
    const selected = hasOverride ? overrides[role.key] : "";

    const label = documentRef.createElement("label");
    label.className = "batch-queue-job-input-role";
    label.dataset.roleKey = role.key;

    const title = documentRef.createElement("span");
    title.textContent = role.label || role.key;

    const select = documentRef.createElement("select");
    select.dataset.roleKey = role.key;
    const inheritLabel = sharedName
      ? `Usa input condiviso: ${sharedName}`
      : "Usa input condiviso (nessuno)";
    select.append(new Option(inheritLabel, "", !hasOverride, !hasOverride));

    const compatible = membersCompatibleWithRole(library, role.accept || "image/*");
    for (const member of compatible) {
      const option = memberSelectOption(member);
      const isSelected = hasOverride && member.filename === selected;
      const opt = new Option(option.label, option.value, isSelected, isSelected);
      opt.title = option.title;
      select.append(opt);
    }
    if (hasOverride && selected && !compatible.some(member => member.filename === selected)) {
      const orphan = new Option(`(non disponibile) ${selected}`, selected, true, true);
      orphan.title = selected;
      select.append(orphan);
    }

    const effective = documentRef.createElement("code");
    effective.className = "batch-queue-effective-input";

    const refreshEffective = () => {
      const filename = resolveQueueJobEffectiveRoleFilename({
        source,
        item: draftItem,
        library,
        availability,
        roleKey: role.key
      });
      effective.textContent = filename ? `Effettivo: ${filename}` : "Effettivo: —";
    };

    select.addEventListener("change", () => {
      draftItem.files = setQueueItemFileOverride(draftItem.files, role.key, select.value);
      refreshEffective();
      onDraftChange?.();
    });

    refreshEffective();
    label.append(title, select, effective);
    section.append(label);
  }

  body.append(section);
}

export { resolveBatchItemFiles };
