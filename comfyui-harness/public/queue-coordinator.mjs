/**
 * v0.8.2 submission coordinator: immediate Generate, queued-next, deferred Batch.
 * Armed execution intent is in-memory only. Reload/recovery never autosubmits.
 */

export const QUEUE_OWNER = Object.freeze({
  NONE: "none",
  GENERATE: "generate",
  QUEUED_NEXT: "queued-next",
  DEFERRED_BATCH: "deferred-batch",
  ACTIVE_BATCH: "active-batch"
});

export const MAX_QUEUED_NEXT = 1;

export function isQueueEmpty({ running = 0, pending = 0 } = {}) {
  return Number(running || 0) === 0 && Number(pending || 0) === 0;
}

export function isSingleActiveRender({ running = 0, pending = 0 } = {}) {
  return Number(running || 0) === 1 && Number(pending || 0) === 0;
}

export function shouldRestoreExecutionIntent() {
  return false;
}

export function canArmQueuedNext({
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  lockOwner = QUEUE_OWNER.NONE
} = {}) {
  if (queuedNext) return false;
  if (deferredBatch) return false;
  if (batchActive) return false;
  if (lockOwner !== QUEUE_OWNER.NONE && lockOwner !== QUEUE_OWNER.GENERATE) return false;
  return Number(running || 0) >= 1 && Number(pending || 0) === 0;
}

export function canArmDeferredBatch({
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  preparedCount = 0
} = {}) {
  if (queuedNext) return false;
  if (deferredBatch) return false;
  if (batchActive) return false;
  if (Number(preparedCount) < 2) return false;
  return isSingleActiveRender({ running, pending });
}

export function resolveGenerateAction({
  blocked = false,
  reason = "",
  submitting = false,
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  lockOwner = QUEUE_OWNER.NONE
} = {}) {
  if (queuedNext) {
    return { action: "queued", label: "In coda", disabled: true, reason: "Prossimo job già in attesa" };
  }
  if (submitting || lockOwner === QUEUE_OWNER.GENERATE) {
    return { action: "busy", label: "Generazione…", disabled: true, reason: "" };
  }
  if (deferredBatch || batchActive || lockOwner === QUEUE_OWNER.DEFERRED_BATCH || lockOwner === QUEUE_OWNER.ACTIVE_BATCH) {
    return { action: "blocked", label: "Genera", disabled: true, reason: "Batch in attesa o in esecuzione" };
  }
  if (blocked) {
    return { action: "blocked", label: "Genera", disabled: true, reason };
  }
  if (isQueueEmpty({ running, pending })) {
    return { action: "generate", label: "Genera", disabled: false, reason: "" };
  }
  if (canArmQueuedNext({ running, pending, queuedNext, deferredBatch, batchActive, lockOwner })) {
    return { action: "queue-next", label: "Metti in coda", disabled: false, reason: "" };
  }
  return { action: "busy", label: "Generazione…", disabled: true, reason: "Generazione in corso" };
}

export function resolveBatchQueueAction({
  submitting = false,
  submitted = false,
  preparedCount = 0,
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false
} = {}) {
  if (submitting) return { action: "submitting", label: "Invio batch…", disabled: true };
  if (submitted || batchActive) return { action: "submitted", label: "Batch inviato", disabled: true };
  if (deferredBatch) return { action: "waiting", label: "Batch in attesa", disabled: true };
  if (preparedCount < 2) return { action: "prepare", label: `Queue batch (${preparedCount || 0})`, disabled: true };
  if (queuedNext) return { action: "blocked", label: "Queue batch", disabled: true, reason: "Prossimo job singolo già in attesa" };
  if (isQueueEmpty({ running, pending })) {
    return { action: "queue", label: `Queue batch (${preparedCount})`, disabled: false };
  }
  if (canArmDeferredBatch({ running, pending, queuedNext, deferredBatch, batchActive, preparedCount })) {
    return { action: "defer", label: "Metti batch in attesa", disabled: false };
  }
  return {
    action: "blocked",
    label: `Queue batch (${preparedCount})`,
    disabled: true,
    reason: `Queue non vuota: ${running} running · ${pending} pending.`
  };
}

export function summarizeQueuedNext(queuedNext) {
  if (!queuedNext) return null;
  const prompt = String(queuedNext.prompt || queuedNext.snapshot?.prompt || "").trim();
  const preview = prompt.length > 96 ? `${prompt.slice(0, 93)}…` : prompt;
  return {
    title: "PROSSIMO JOB",
    status: "IN ATTESA",
    detail: "In attesa che la coda si liberi",
    preview,
    duration: queuedNext.duration ?? queuedNext.snapshot?.duration,
    model: queuedNext.model || queuedNext.snapshot?.model || "",
    seed: queuedNext.seed ?? queuedNext.snapshot?.seed,
    canCancel: true,
    canUpdate: true
  };
}

export function summarizeDeferredBatch(deferredBatch) {
  if (!deferredBatch) return null;
  const total = Array.isArray(deferredBatch.items) ? deferredBatch.items.length : Number(deferredBatch.preparedCount || 0);
  return {
    title: "BATCH",
    status: "IN ATTESA DELLA CODA",
    detail: `${total} job preparati · In attesa che il render corrente termini`,
    preparedCount: total,
    canCancel: !deferredBatch.job1Submitted
  };
}

let sharedCoordinator = null;

export function setSharedCoordinator(coordinator) {
  sharedCoordinator = coordinator;
  return coordinator;
}

export function getSharedCoordinator() {
  return sharedCoordinator;
}

export function createQueueCoordinator({ submit } = {}) {
  if (typeof submit !== "function") {
    throw new Error("createQueueCoordinator requires a submit(payload) function");
  }

  let lockOwner = QUEUE_OWNER.NONE;
  let queuedNext = null;
  let deferredBatch = null;
  let batchActive = false;
  let lastQueue = { running: 0, pending: 0 };
  let submitCount = 0;
  let gpuWrites = 0;
  let observeInFlight = false;
  const listeners = new Set();

  function emit() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function snapshot() {
    return {
      lockOwner,
      queuedNext: queuedNext ? { ...queuedNext, snapshot: { ...queuedNext.snapshot } } : null,
      deferredBatch: deferredBatch ? { ...deferredBatch, items: [...(deferredBatch.items || [])] } : null,
      batchActive,
      lastQueue: { ...lastQueue },
      submitCount,
      gpuWrites
    };
  }

  function claim(owner) {
    if (lockOwner !== QUEUE_OWNER.NONE && lockOwner !== owner) return false;
    lockOwner = owner;
    return true;
  }

  function release(owner) {
    if (lockOwner === owner) lockOwner = QUEUE_OWNER.NONE;
  }

  async function submitOnce(owner, payload) {
    if (!claim(owner)) return { ok: false, reason: "locked", submitted: false };
    submitCount += 1;
    try {
      const result = await submit(payload);
      return { ok: true, submitted: true, result };
    } finally {
      if (owner !== QUEUE_OWNER.ACTIVE_BATCH && owner !== QUEUE_OWNER.DEFERRED_BATCH) {
        release(owner);
      }
    }
  }

  return {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    getQueuedNext() {
      return queuedNext ? { ...queuedNext, snapshot: { ...queuedNext.snapshot } } : null;
    },
    getDeferredBatch() {
      return deferredBatch ? { ...deferredBatch } : null;
    },
    armQueuedNext(snapshotPayload = {}) {
      const queue = lastQueue;
      if (!canArmQueuedNext({
        ...queue,
        queuedNext,
        deferredBatch,
        batchActive,
        lockOwner
      })) {
        return { ok: false, reason: queuedNext ? "already-armed" : "not-eligible" };
      }
      const copy = JSON.parse(JSON.stringify(snapshotPayload));
      queuedNext = {
        snapshot: copy,
        prompt: copy.prompt || "",
        duration: copy.duration,
        model: copy.model || "",
        seed: copy.seed,
        status: "waiting",
        submitClaimed: false,
        cancelled: false
      };
      emit();
      return { ok: true, queuedNext: this.getQueuedNext() };
    },
    cancelQueuedNext() {
      if (!queuedNext || queuedNext.submitClaimed) return { ok: false, reason: "not-cancellable" };
      queuedNext = null;
      emit();
      return { ok: true };
    },
    updateQueuedNextFromDraft(snapshotPayload = {}) {
      if (!queuedNext || queuedNext.submitClaimed) return { ok: false, reason: "not-updatable" };
      const copy = JSON.parse(JSON.stringify(snapshotPayload));
      queuedNext = {
        ...queuedNext,
        snapshot: copy,
        prompt: copy.prompt || "",
        duration: copy.duration,
        model: copy.model || "",
        seed: copy.seed
      };
      emit();
      return { ok: true, queuedNext: this.getQueuedNext() };
    },
    armDeferredBatch({ items = [], snapshot: batchSnapshot = {}, submitAll } = {}) {
      if (typeof submitAll !== "function") return { ok: false, reason: "submitAll-required" };
      if (!canArmDeferredBatch({
        ...lastQueue,
        queuedNext,
        deferredBatch,
        batchActive,
        preparedCount: items.length
      })) {
        return { ok: false, reason: deferredBatch ? "already-armed" : "not-eligible" };
      }
      deferredBatch = {
        items: items.map(item => ({ ...item })),
        snapshot: JSON.parse(JSON.stringify(batchSnapshot)),
        submitAll,
        status: "waiting",
        job1Submitted: false,
        submitClaimed: false
      };
      emit();
      return { ok: true };
    },
    cancelDeferredBatch() {
      if (!deferredBatch || deferredBatch.job1Submitted || deferredBatch.submitClaimed) {
        return { ok: false, reason: "not-cancellable" };
      }
      deferredBatch = null;
      emit();
      return { ok: true };
    },
    async tryImmediateGenerate(payload) {
      if (queuedNext || deferredBatch || batchActive) return { ok: false, reason: "busy-intent" };
      if (!isQueueEmpty(lastQueue) && Number(lastQueue.running || 0) > 0) {
        return { ok: false, reason: "queue-busy" };
      }
      if (!claim(QUEUE_OWNER.GENERATE)) return { ok: false, reason: "locked" };
      const result = await submitOnce(QUEUE_OWNER.GENERATE, payload);
      emit();
      return result;
    },
    beginActiveBatch() {
      if (lockOwner === QUEUE_OWNER.ACTIVE_BATCH || lockOwner === QUEUE_OWNER.DEFERRED_BATCH) {
        lockOwner = QUEUE_OWNER.ACTIVE_BATCH;
        batchActive = true;
        emit();
        return { ok: true };
      }
      if (queuedNext) return { ok: false, reason: "intent-armed" };
      if (deferredBatch && !deferredBatch.submitClaimed) return { ok: false, reason: "intent-armed" };
      if (!claim(QUEUE_OWNER.ACTIVE_BATCH)) return { ok: false, reason: "locked" };
      batchActive = true;
      emit();
      return { ok: true };
    },
    endActiveBatch() {
      batchActive = false;
      release(QUEUE_OWNER.ACTIVE_BATCH);
      release(QUEUE_OWNER.DEFERRED_BATCH);
      emit();
    },
    markQueue({ running = 0, pending = 0 } = {}) {
      lastQueue = { running: Number(running || 0), pending: Number(pending || 0) };
    },
    async observeQueue({ running = 0, pending = 0 } = {}) {
      lastQueue = { running: Number(running || 0), pending: Number(pending || 0) };
      if (!isQueueEmpty(lastQueue)) return { submitted: false };
      if (observeInFlight) return { submitted: false, skipped: "in-flight" };

      if (queuedNext && !queuedNext.cancelled && !queuedNext.submitClaimed) {
        queuedNext.submitClaimed = true;
        observeInFlight = true;
        const payload = queuedNext.snapshot;
        queuedNext.status = "submitting";
        try {
          const result = await submitOnce(QUEUE_OWNER.QUEUED_NEXT, payload);
          queuedNext = null;
          emit();
          return { submitted: "queued-next", result };
        } finally {
          observeInFlight = false;
        }
      }

      if (deferredBatch && !deferredBatch.job1Submitted && !deferredBatch.submitClaimed) {
        deferredBatch.submitClaimed = true;
        deferredBatch.job1Submitted = true;
        observeInFlight = true;
        const runner = deferredBatch.submitAll;
        try {
          if (!claim(QUEUE_OWNER.DEFERRED_BATCH) && lockOwner !== QUEUE_OWNER.DEFERRED_BATCH) {
            deferredBatch.submitClaimed = false;
            deferredBatch.job1Submitted = false;
            return { submitted: false, reason: "locked" };
          }
          lockOwner = QUEUE_OWNER.ACTIVE_BATCH;
          batchActive = true;
          const result = await runner();
          deferredBatch = null;
          emit();
          return { submitted: "deferred-batch", result };
        } finally {
          observeInFlight = false;
        }
      }

      return { submitted: false };
    }
  };
}
