/**
 * Render-complete card helpers. Opening an output never queues or writes GPU.
 */

import { formatDurationCompact, normalizeDurationSeconds } from "../lib/duration.mjs";

export const LATEST_OUTPUT_KEY = "h3LatestOutput:v1";

export function buildCompletionCard({
  filename = "",
  url = "",
  duration,
  model = "",
  seed,
  completedAt = null,
  promptId = "",
  latest = true
} = {}) {
  if (!filename && !url) return null;
  return {
    title: "✓ LAVORO FINITO",
    filename: String(filename || ""),
    url: String(url || ""),
    duration: duration == null || duration === "" ? null : normalizeDurationSeconds(duration),
    durationLabel: duration == null || duration === "" ? "" : formatDurationCompact(duration),
    model: String(model || ""),
    seed: seed == null || seed === "" ? "" : String(seed),
    completedAt,
    promptId: String(promptId || ""),
    latest: Boolean(latest)
  };
}

export function pickLatestOutputItem(items = []) {
  if (!Array.isArray(items) || !items.length) return null;
  const withUrl = items.find(item => item?.url && (item.filename || item.name));
  return withUrl || items[0] || null;
}

export function reconstructCompletionFromOutputs(items = [], extras = {}) {
  const item = pickLatestOutputItem(items);
  if (!item?.url && !item?.filename) return null;
  return buildCompletionCard({
    filename: item.filename || item.name || "",
    url: item.url || "",
    duration: extras.duration,
    model: extras.model,
    seed: extras.seed,
    completedAt: extras.completedAt || Date.now(),
    promptId: extras.promptId || "",
    latest: true
  });
}

export function persistLatestOutput(card, storage) {
  if (!card || !storage) return null;
  try {
    storage.setItem(LATEST_OUTPUT_KEY, JSON.stringify({ version: 1, card }));
  } catch { /* ignore */ }
  return card;
}

export function readLatestOutput(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(LATEST_OUTPUT_KEY) || "null");
    if (!parsed?.card?.url && !parsed?.card?.filename) return null;
    return buildCompletionCard(parsed.card);
  } catch {
    return null;
  }
}

export function clearLatestOutput(storage) {
  try { storage?.removeItem?.(LATEST_OUTPUT_KEY); } catch { /* ignore */ }
}

export function batchJobOutputRows(jobs = []) {
  let latestIndex = -1;
  jobs.forEach((job, index) => {
    if (job?.state === "completed" && pickLatestOutputItem(job.outputs || [])) latestIndex = index;
  });
  return jobs.map((job, index) => {
    const output = pickLatestOutputItem(job.outputs || []);
    return {
      label: job.label || `Job ${index + 1}`,
      state: job.state || "pending",
      completed: job.state === "completed",
      filename: output?.filename || output?.name || "",
      url: output?.url || "",
      latest: index === latestIndex,
      durationLabel: job.item?.duration == null || job.item?.duration === ""
        ? ""
        : formatDurationCompact(job.item.duration)
    };
  });
}

export function outputActionSideEffects() {
  return { queuePosts: 0, promptPosts: 0, gpuWrites: 0 };
}
