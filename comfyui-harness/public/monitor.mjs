// Pure helpers for the ComfyUI progress / terminal monitor. DOM-free.

export const QUEUE_POLL_MS = 8000;
export const LOG_POLL_MS = 10000;
export const EVENT_FEED_LIMIT = 200;
export const TERMINAL_ENTRY_LIMIT = 400;

export function clampDisplayProgress(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) {
    return { kind: "indeterminate", value: null, max: null, percent: null };
  }
  const safeValue = Math.max(0, Math.min(v, m));
  return {
    kind: "numeric",
    value: safeValue,
    max: m,
    percent: Math.round(safeValue / m * 100)
  };
}

export function progressFromMessage(message = {}) {
  if (message.type === "progress") {
    return {
      ...clampDisplayProgress(message.data?.value, message.data?.max),
      nodeId: message.data?.node ?? null,
      displayNode: null,
      promptId: message.data?.prompt_id ?? null,
      source: "progress"
    };
  }
  if (message.type === "progress_state") {
    const nodes = Object.values(message.data?.nodes || {});
    const active = nodes.filter(node => node.state === "running").at(-1) || null;
    if (!active) {
      return {
        kind: "indeterminate",
        value: null,
        max: null,
        percent: null,
        nodeId: null,
        displayNode: null,
        promptId: message.data?.prompt_id ?? null,
        source: "progress_state"
      };
    }
    const numeric = clampDisplayProgress(active.value, active.max);
    return {
      ...numeric,
      nodeId: active.node_id ?? active.real_node_id ?? null,
      displayNode: active.display_node_id ?? null,
      promptId: active.prompt_id ?? message.data?.prompt_id ?? null,
      source: "progress_state",
      nodeState: active.state
    };
  }
  if (message.type === "executing") {
    const node = message.data?.node;
    if (node === null || node === undefined) {
      return {
        kind: "complete",
        value: null,
        max: null,
        percent: null,
        nodeId: null,
        displayNode: null,
        promptId: message.data?.prompt_id ?? null,
        source: "executing"
      };
    }
    return {
      kind: "indeterminate",
      value: null,
      max: null,
      percent: null,
      nodeId: node,
      displayNode: message.data?.display_node ?? null,
      promptId: message.data?.prompt_id ?? null,
      source: "executing"
    };
  }
  return null;
}

export function applyMonitorEvent(state, message) {
  const next = { ...state, events: [...(state.events || [])] };
  const stamp = Date.now();
  const progress = progressFromMessage(message);

  if (["execution_error", "execution_interrupted"].includes(message.type)) {
    next.phase = message.type === "execution_interrupted" ? "interrupted" : "error";
    next.progress = { kind: "indeterminate", value: null, max: null, percent: null };
    next.events.push(formatLifecycleEvent(stamp, message.type === "execution_interrupted" ? "Job interrotto" : "Job in errore", message));
    return trimEvents(next);
  }

  if (progress) {
    if (progress.promptId) next.promptId = progress.promptId;
    if (progress.nodeId !== undefined) next.nodeId = progress.nodeId;
    if (progress.displayNode !== undefined) next.displayNode = progress.displayNode;

    if (progress.kind === "complete") {
      next.phase = "completed";
      next.progress = { kind: "complete", value: null, max: null, percent: null };
      next.events.push(formatLifecycleEvent(stamp, "Esecuzione completata (executing null)", message));
    } else if (progress.kind === "numeric") {
      next.phase = "running";
      next.progress = progress;
      // Avoid flooding the feed on every step; record milestones and first numeric sighting.
      const key = `${progress.value}/${progress.max}`;
      if (next.lastProgressKey !== key) {
        next.lastProgressKey = key;
        next.events.push(formatLifecycleEvent(stamp, `Progresso nodo ${progress.value}/${progress.max}`, message));
      }
    } else {
      next.phase = "running";
      next.progress = progress;
      if (progress.nodeId && next.lastNodeKey !== String(progress.nodeId)) {
        next.lastNodeKey = String(progress.nodeId);
        const label = progress.displayNode || progress.nodeId;
        next.events.push(formatLifecycleEvent(stamp, `Nodo ${label} in esecuzione`, message));
      }
    }
  }

  if (message.type === "executed") {
    const label = message.data?.display_node || message.data?.node || "?";
    next.events.push(formatLifecycleEvent(stamp, `Nodo ${label} completato`, message));
  }

  if (message.type === "logs" && Array.isArray(message.data?.entries)) {
    next.terminal = mergeTerminalEntries(next.terminal || [], message.data.entries);
  }

  return trimEvents(next);
}

export function trimEvents(state) {
  if ((state.events || []).length > EVENT_FEED_LIMIT) {
    state.events = state.events.slice(-EVENT_FEED_LIMIT);
  }
  return state;
}

export function mergeTerminalEntries(existing, incoming) {
  const merged = [...existing, ...incoming.map(normalizeLogEntry).filter(Boolean)];
  return merged.slice(-TERMINAL_ENTRY_LIMIT);
}

export function normalizeLogEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { t: null, m: stripAnsi(entry) };
  return {
    t: entry.t || null,
    m: stripAnsi(String(entry.m ?? entry.message ?? ""))
  };
}

export function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "");
}

export function formatLifecycleEvent(timestampMs, text) {
  return {
    t: formatClock(timestampMs),
    m: text,
    at: timestampMs
  };
}

export function formatClock(timestampMs = Date.now()) {
  try {
    return new Date(timestampMs).toLocaleTimeString("it-IT", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

export function formatElapsed(ms, { approximate = false } = {}) {
  if (!Number.isFinite(ms) || ms < 0) return approximate ? "≈ non disponibile" : "non disponibile";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  return approximate ? `≈ ${body}` : body;
}

export function resolveJobStartMs({ createdAt, storedStartedAt, firstSeenAt, now = Date.now() } = {}) {
  // Only ComfyUI create_time is authoritative/exact.
  if (Number.isFinite(Number(createdAt)) && Number(createdAt) > 0) {
    let ts = Number(createdAt);
    if (ts < 1e12) ts *= 1000;
    return { ms: ts, approximate: false, source: "create_time", elapsedMs: Math.max(0, now - ts) };
  }

  // Local first-seen timestamps (including values persisted across refresh) stay approximate.
  const localCandidates = [];
  if (Number.isFinite(Number(storedStartedAt)) && Number(storedStartedAt) > 0) {
    localCandidates.push({ ms: Number(storedStartedAt), approximate: true, source: "session" });
  }
  if (Number.isFinite(Number(firstSeenAt)) && Number(firstSeenAt) > 0) {
    localCandidates.push({ ms: Number(firstSeenAt), approximate: true, source: "local" });
  }
  if (!localCandidates.length) return { ms: null, approximate: true, source: "unknown", elapsedMs: null };
  localCandidates.sort((a, b) => a.ms - b.ms);
  const chosen = localCandidates[0];
  return { ...chosen, elapsedMs: Math.max(0, now - chosen.ms) };
}

// Recovery/inspection must never adopt another live client's WebSocket identity.
export function resolveObserverClientId({ localClientId, activeClientId } = {}) {
  const local = localClientId ? String(localClientId) : "";
  if (!local) throw new Error("localClientId required for observer websocket");
  return {
    clientId: local,
    reusedActiveClientId: false,
    ignoredActiveClientId: activeClientId ? String(activeClientId) : null
  };
}

export function parseQueueCounts(queue = {}) {
  const running = Array.isArray(queue.queue_running) ? queue.queue_running.length : 0;
  const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0;
  return { running, pending };
}

export function summarizeMonitor(state = {}) {
  const progress = state.progress || { kind: "idle", value: null, max: null, percent: null };
  const nodeLabel = state.displayNode || state.nodeId || "non disponibile";
  let barMode = "idle";
  let summary = "In attesa";

  if (state.phase === "completed") {
    barMode = "complete";
    summary = "Completato";
  } else if (state.phase === "error") {
    barMode = "error";
    summary = "Errore";
  } else if (state.phase === "interrupted") {
    barMode = "error";
    summary = "Interrotta";
  } else if (progress.kind === "numeric") {
    barMode = "numeric";
    summary = `Progresso nodo attivo · ${progress.value}/${progress.max} · ${progress.percent}%`;
  } else if (state.phase === "running") {
    barMode = "indeterminate";
    summary = nodeLabel === "non disponibile" ? "Elaborazione…" : `Nodo in esecuzione · ${nodeLabel}`;
  }

  return {
    barMode,
    summary,
    percent: progress.kind === "numeric" ? progress.percent : null,
    value: progress.value,
    max: progress.max,
    nodeLabel,
    promptId: state.promptId || null,
    queueRunning: Number.isFinite(state.queueRunning) ? state.queueRunning : null,
    queuePending: Number.isFinite(state.queuePending) ? state.queuePending : null,
    connection: state.connection || "non disponibile",
    title: state.title || "RENDERING"
  };
}

export function initialMonitorState(overrides = {}) {
  return {
    phase: "idle",
    progress: { kind: "idle", value: null, max: null, percent: null },
    nodeId: null,
    displayNode: null,
    promptId: null,
    queueRunning: 0,
    queuePending: 0,
    connection: "Connessione…",
    title: "RENDERING",
    events: [],
    terminal: [],
    lastProgressKey: null,
    lastNodeKey: null,
    ...overrides
  };
}

export function compactProgressText(summary) {
  if (summary.barMode === "numeric") return `In esecuzione · ${summary.value}/${summary.max} · ${summary.percent}%`;
  if (summary.barMode === "indeterminate") return summary.summary;
  if (summary.barMode === "complete") return "Completato";
  if (summary.barMode === "error") return summary.summary;
  return "In attesa";
}
