import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  assertValidProjectId,
  isValidProjectId,
  parseProjectJson,
  projectFileName,
  publicProjectView,
  resolveSafeProjectPathNode,
  toPersistedProject,
  uniqueProjectId
} from "./projects.mjs";

async function atomicWrite(filePath, contents) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, filePath);
}

export function createProjectStore(projectDirectory) {
  const root = path.resolve(projectDirectory);

  async function ensureDir() {
    await mkdir(root, { recursive: true });
  }

  function filePathFor(id) {
    return resolveSafeProjectPathNode(path, root, id);
  }

  async function list() {
    await ensureDir();
    const files = (await readdir(root)).filter(name => name.endsWith(".local.json"));
    const items = [];
    for (const file of files) {
      try {
        const text = await readFile(path.join(root, file), "utf8");
        const project = parseProjectJson(text);
        if (!project.id) project.id = file.replace(/\.local\.json$/, "");
        if (!isValidProjectId(project.id)) continue;
        items.push(publicProjectView(project));
      } catch {
        // Skip malformed files without crashing the server.
      }
    }
    return items.sort((a, b) => String(a.label).localeCompare(String(b.label), "it"));
  }

  async function read(id) {
    assertValidProjectId(id);
    const filePath = filePathFor(id);
    if (!existsSync(filePath)) {
      const error = new Error("Project not found");
      error.status = 404;
      throw error;
    }
    try {
      const project = parseProjectJson(await readFile(filePath, "utf8"));
      project.id = id;
      return publicProjectView(project);
    } catch (error) {
      if (error.status) throw error;
      const malformed = new Error("Malformed project JSON");
      malformed.status = 400;
      throw malformed;
    }
  }

  async function create(input) {
    await ensureDir();
    const existing = await list();
    const existingIds = existing.map(item => item.id);
    const desired = input.id || uniqueProjectId(input.label || "project", existingIds);
    const id = uniqueProjectId(desired, existingIds);
    if (existingIds.includes(id)) {
      const error = new Error("Project id already exists");
      error.status = 409;
      throw error;
    }
    const persisted = toPersistedProject({
      ...input,
      id,
      label: input.label || id
    });
    await atomicWrite(filePathFor(id), `${JSON.stringify(persisted, null, 2)}\n`);
    return publicProjectView(persisted);
  }

  async function update(id, input) {
    assertValidProjectId(id);
    const current = await read(id);
    const merged = {
      ...current,
      ...input,
      id,
      label: input.label ?? current.label
    };
    if (Object.prototype.hasOwnProperty.call(input, "batchDraft") && input.batchDraft == null) {
      merged.batchDraft = null;
    }
    const persisted = toPersistedProject(merged);
    await atomicWrite(filePathFor(id), `${JSON.stringify(persisted, null, 2)}\n`);
    return publicProjectView(persisted);
  }

  async function duplicate(id, { label, newId } = {}) {
    const source = await read(id);
    const existingIds = (await list()).map(item => item.id);
    const desired = newId || uniqueProjectId(label || `${source.label} copy`, existingIds);
    const idOut = uniqueProjectId(desired, existingIds);
    if (existingIds.includes(idOut)) {
      const error = new Error("Project id already exists");
      error.status = 409;
      throw error;
    }
    return create({
      ...source,
      id: idOut,
      label: label || `${source.label} (copia)`
    });
  }

  async function remove(id) {
    assertValidProjectId(id);
    const filePath = filePathFor(id);
    if (!existsSync(filePath)) {
      const error = new Error("Project not found");
      error.status = 404;
      throw error;
    }
    await unlink(filePath);
    return { ok: true, id };
  }

  return { root, list, read, create, update, duplicate, remove, filePathFor, projectFileName };
}
