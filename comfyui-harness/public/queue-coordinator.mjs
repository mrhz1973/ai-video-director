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
  batchQueueArmed = false,
  lockOwner = QUEUE_OWNER.NONE
} = {}) {
  if (batchQueueArmed) return false;
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
  batchQueueArmed = false,
  preparedCount = 0
} = {}) {
  if (batchQueueArmed) return false;
  if (queuedNext) return false;
  if (deferredBatch) return false;
  if (batchActive) return false;
  if (Number(preparedCount) < 2) return false;
  return isSingleActiveRender({ running, pending });
}

export function canArmMultiBatchQueue({
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  lockOwner = QUEUE_OWNER.NONE
} = {}) {
  if (queuedNext || deferredBatch || batchActive
    || lockOwner === QUEUE_OWNER.ACTIVE_BATCH
    || lockOwner === QUEUE_OWNER.DEFERRED_BATCH) {
    return {
      ok: false,
      code: "legacy-intent",
      error: "Esiste già un job/batch in attesa. Attendi o annullalo prima di avviare la Coda Batch."
    };
  }
  return { ok: true };
}

export const SINGLE_RENDER_ACTION_LABELS = Object.freeze({
  idle: "Genera singolo",
  busy: "Generazione…",
  queued: "In coda",
  blocked: "Genera singolo",
  queueNext: "Metti in coda"
});

export const BATCH_EXECUTION_LABELS = Object.freeze({
  queue: (count) => `Avvia batch (${count})`,
  defer: "Metti batch in attesa",
  submitting: "Invio batch…",
  submitted: "Batch inviato",
  waiting: "Batch in attesa",
  prepare: (count) => `Avvia batch (${count || 0})`,
  blocked: (count) => `Avvia batch (${count || 0})`
});

export function resolveGenerateAction({
  blocked = false,
  reason = "",
  submitting = false,
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  batchQueueArmed = false,
  lockOwner = QUEUE_OWNER.NONE
} = {}) {
  if (batchQueueArmed) {
    return { action: "blocked", label: SINGLE_RENDER_ACTION_LABELS.blocked, disabled: true, reason: "Coda Batch attiva." };
  }
  if (queuedNext) {
    return { action: "queued", label: SINGLE_RENDER_ACTION_LABELS.queued, disabled: true, reason: "Prossimo job già in attesa" };
  }
  if (submitting || lockOwner === QUEUE_OWNER.GENERATE) {
    return { action: "busy", label: SINGLE_RENDER_ACTION_LABELS.busy, disabled: true, reason: "" };
  }
  if (deferredBatch || batchActive || lockOwner === QUEUE_OWNER.DEFERRED_BATCH || lockOwner === QUEUE_OWNER.ACTIVE_BATCH) {
    return { action: "blocked", label: SINGLE_RENDER_ACTION_LABELS.blocked, disabled: true, reason: "Batch in attesa o in esecuzione" };
  }
  if (blocked) {
    return { action: "blocked", label: SINGLE_RENDER_ACTION_LABELS.blocked, disabled: true, reason };
  }
  if (isQueueEmpty({ running, pending })) {
    return { action: "generate", label: SINGLE_RENDER_ACTION_LABELS.idle, disabled: false, reason: "" };
  }
  if (canArmQueuedNext({ running, pending, queuedNext, deferredBatch, batchActive, lockOwner })) {
    return { action: "queue-next", label: SINGLE_RENDER_ACTION_LABELS.queueNext, disabled: false, reason: "" };
  }
  return { action: "busy", label: SINGLE_RENDER_ACTION_LABELS.busy, disabled: true, reason: "Generazione in corso" };
}

export function resolveBatchQueueAction({
  submitting = false,
  submitted = false,
  preparedCount = 0,
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  batchQueueArmed = false
} = {}) {
  if (batchQueueArmed) {
    return { action: "blocked", label: BATCH_EXECUTION_LABELS.blocked(preparedCount), disabled: true, reason: "Coda Batch attiva." };
  }
  if (submitting) return { action: "submitting", label: BATCH_EXECUTION_LABELS.submitting, disabled: true };
  if (submitted || batchActive) return { action: "submitted", label: BATCH_EXECUTION_LABELS.submitted, disabled: true };
  if (deferredBatch) return { action: "waiting", label: BATCH_EXECUTION_LABELS.waiting, disabled: true };
  if (preparedCount < 2) return { action: "prepare", label: BATCH_EXECUTION_LABELS.prepare(preparedCount), disabled: true };
  if (queuedNext) return { action: "blocked", label: BATCH_EXECUTION_LABELS.blocked(preparedCount), disabled: true, reason: "Prossimo job singolo già in attesa" };
  if (isQueueEmpty({ running, pending })) {
    return { action: "queue", label: BATCH_EXECUTION_LABELS.queue(preparedCount), disabled: false };
  }
  if (canArmDeferredBatch({ running, pending, queuedNext, deferredBatch, batchActive, preparedCount })) {
    return { action: "defer", label: BATCH_EXECUTION_LABELS.defer, disabled: false };
  }
  return {
    action: "blocked",
    label: BATCH_EXECUTION_LABELS.blocked(preparedCount),
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
  let batchQueueArmed = false;
  let batchActive = false;
  let lastQueue = { running: 0, pending: 0 };
  let submitCount = 0;
  let gpuWrites = 0;
  let observeInFlight = false;
  /** @type {null | { ownerId: string, kind: string }} */
  let laneReservation = null;
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
    getLaneReservation() {
      return laneReservation ? { ...laneReservation } : null;
    },
    setLaneReservation(next) {
      laneReservation = next && next.ownerId && next.kind && next.leaseToken
        ? {
          ownerId: String(next.ownerId),
          kind: String(next.kind),
          leaseToken: String(next.leaseToken),
          ...(next.pageSessionId ? { pageSessionId: String(next.pageSessionId) } : {})
        }
        : null;
      return laneReservation ? { ...laneReservation } : null;
    },
    clearLaneReservation() {
      laneReservation = null;
    },
    setBatchQueueArmed(value) {
      batchQueueArmed = Boolean(value);
      return batchQueueArmed;
    },
    isBatchQueueArmed() {
      return Boolean(batchQueueArmed);
    },
    getQueuedNext() {
      return queuedNext ? { ...queuedNext, snapshot: { ...queuedNext.snapshot } } : null;
    },
    getDeferredBatch() {
      return deferredBatch ? { ...deferredBatch } : null;
    },
    armQueuedNext(snapshotPayload = {}) {
      if (batchQueueArmed) return { ok: false, reason: "batch-queue-armed" };
      const queue = lastQueue;
      if (!canArmQueuedNext({ ...queue, queuedNext, deferredBatch, batchActive, batchQueueArmed, lockOwner })) {
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
      if (batchQueueArmed) return { ok: false, reason: "batch-queue-armed" };
      if (typeof submitAll !== "function") return { ok: false, reason: "submitAll-required" };
      if (!canArmDeferredBatch({ ...lastQueue, queuedNext, deferredBatch, batchActive, batchQueueArmed, preparedCount: items.length })) {
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
