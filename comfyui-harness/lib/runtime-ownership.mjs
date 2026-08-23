/**
 * In-memory runtime ownership registry (Issue #51). Not persisted to disk/projects.
 */

export function createRuntimeOwnershipRegistry() {
  /** @type {Map<string, object>} */
  const byPromptId = new Map();

  return {
    register(promptId, record = {}) {
      const id = String(promptId || "").trim();
      if (!id) return null;
      const entry = {
        promptId: id,
        kind: record.kind === "batch" ? "batch" : "single",
        batchId: record.batchId ? String(record.batchId) : null,
        batchIndex: Number.isFinite(Number(record.batchIndex)) ? Number(record.batchIndex) : null,
        clientId: record.clientId ? String(record.clientId) : null,
        acceptedAt: Number(record.acceptedAt) || Date.now()
      };
      byPromptId.set(id, entry);
      return { ...entry };
    },

    get(promptId) {
      const id = String(promptId || "").trim();
      const entry = byPromptId.get(id);
      return entry ? { ...entry } : null;
    },

    has(promptId) {
      return byPromptId.has(String(promptId || "").trim());
    },

    listByBatchId(batchId) {
      const id = String(batchId || "").trim();
      if (!id) return [];
      return [...byPromptId.values()].filter(entry => entry.batchId === id).map(entry => ({ ...entry }));
    },

    ownedPromptIdsForBatch(batchId) {
      return new Set(this.listByBatchId(batchId).map(entry => entry.promptId));
    },

    size() {
      return byPromptId.size;
    },

    clear() {
      byPromptId.clear();
    }
  };
}
