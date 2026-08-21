export const MIN_BATCH_JOBS = 2;
export const MAX_BATCH_JOBS = 8;

export function clampBatchCount(value, { min = MIN_BATCH_JOBS, max = MAX_BATCH_JOBS } = {}) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

export function createBatchItems(base = {}, count = 4) {
  const total = clampBatchCount(count);
  const seed = Number(base.seed);
  const seedIsFinite = Number.isFinite(seed);
  return Array.from({ length: total }, (_, index) => ({
    id: `job-${index + 1}`,
    prompt: String(base.prompt || ""),
    seed: seedIsFinite ? String(Math.trunc(seed) + index) : String(base.seed ?? "1"),
    duration: String(base.duration ?? "5"),
    steps: String(base.steps ?? "20"),
    megapixels: String(base.megapixels ?? "0.3"),
    aspect: String(base.aspect || "16:9")
  }));
}

export function duplicateBatchItem(items = [], index = 0) {
  const source = items[index];
  if (!source || items.length >= MAX_BATCH_JOBS) return [...items];
  const seed = Number(source.seed);
  const copy = {
    ...source,
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    seed: Number.isFinite(seed) ? String(Math.trunc(seed) + 1) : String(source.seed || "1")
  };
  const next = [...items];
  next.splice(index + 1, 0, copy);
  return next;
}

export function moveBatchItem(items = [], fromIndex, toIndex) {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function removeBatchItem(items = [], index) {
  if (items.length <= MIN_BATCH_JOBS) return [...items];
  return items.filter((_, i) => i !== index);
}

export function validateBatchDraft({
  items = [],
  safeFitStatus = "not-applicable",
  requiredFiles = {},
  requiredKeys = [],
  unsupportedVideoRoles = [],
  megapixelsMin = 0.1,
  megapixelsMax = 16,
  durationMin = 4,
  durationMax = 15
} = {}) {
  const errors = [];
  if (items.length < MIN_BATCH_JOBS || items.length > MAX_BATCH_JOBS) {
    errors.push(`Il batch deve contenere da ${MIN_BATCH_JOBS} a ${MAX_BATCH_JOBS} job.`);
  }
  if (["needs-apply", "unexpected"].includes(safeFitStatus)) {
    errors.push(safeFitStatus === "needs-apply" ? "Workflow image-fit non aggiornato." : "Workflow image-fit non valido.");
  }
  if (unsupportedVideoRoles.length) {
    errors.push(`Batch v1 non supporta ancora input video: ${unsupportedVideoRoles.join(", ")}.`);
  }
  const missingRoles = requiredKeys.filter(key => !requiredFiles[key]);
  if (missingRoles.length) errors.push(`Input workflow mancanti: ${missingRoles.join(", ")}.`);

  const perItem = [];
  items.forEach((item, index) => {
    const itemErrors = [];
    const label = `Job ${index + 1}`;
    if (!String(item.prompt || "").trim()) itemErrors.push("prompt vuoto");
    const seed = Number(item.seed);
    if (!Number.isFinite(seed)) itemErrors.push("seed non valido");
    const steps = Number(item.steps);
    if (!Number.isFinite(steps) || steps < 1) itemErrors.push("steps non validi");
    const duration = Number(item.duration);
    if (!Number.isFinite(duration) || duration < durationMin || duration > durationMax) itemErrors.push(`durata fuori ${durationMin}–${durationMax}s`);
    const mp = Number(item.megapixels);
    if (!Number.isFinite(mp) || mp < megapixelsMin || mp > megapixelsMax) itemErrors.push(`MP fuori ${megapixelsMin}–${megapixelsMax}`);
    if (!String(item.aspect || "").trim()) itemErrors.push("aspect mancante");
    if (itemErrors.length) {
      perItem.push({ index, errors: itemErrors });
      errors.push(`${label}: ${itemErrors.join(", ")}.`);
    }
  });

  return { valid: errors.length === 0, errors, perItem };
}

export function summarizeBatchJobs(jobs = []) {
  const summary = { total: jobs.length, completed: 0, running: 0, pending: 0, failed: 0, interrupted: 0, notSubmitted: 0 };
  for (const job of jobs) {
    const state = job?.state || "pending";
    if (state === "completed") summary.completed += 1;
    else if (state === "running") summary.running += 1;
    else if (state === "error") summary.failed += 1;
    else if (state === "interrupted") summary.interrupted += 1;
    else if (state === "not-submitted") summary.notSubmitted += 1;
    else summary.pending += 1;
  }
  return summary;
}

export function isTerminalBatchState(state) {
  return ["completed", "error", "interrupted", "not-submitted"].includes(String(state || ""));
}
