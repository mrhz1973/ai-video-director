import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneAndBind, resolutionSettings, selectMegapixels, collectOutputs } from "./lib/workflow.mjs";
import { createLogger } from "./lib/logger.mjs";
import { createProjectStore } from "./lib/project-store.mjs";
import { isValidProjectId } from "./lib/projects.mjs";
import { probeAssetStatuses } from "./lib/asset-status.mjs";
import { parseAssetStatusDescriptors } from "./lib/asset-ref.mjs";
import {
  inspectH3SafeFit,
  publicSafeFitSummary,
  safeFitBlocksGenerate,
  describeSafeFitBlocker
} from "./lib/h3-safe-fit.mjs";
import {
  attachSafeStaticStream,
  canWriteResponse,
  endStartedResponse,
  sendBufferedUpstream,
  sendJson
} from "./lib/http-response.mjs";
import { resolveConfigPath } from "./lib/config-path.mjs";
import {
  GpuPowerError,
  gpuPowerPublicPayload,
  readGpuPowerStatus
} from "./lib/gpu-power.mjs";
import {
  applyGpuPowerMode,
  gpuHelperPublicPayload,
  readGpuHelperState
} from "./lib/gpu-power-helper.mjs";
import { createRuntimeOwnershipRegistry } from "./lib/runtime-ownership.mjs";
import { createRuntimeControlService } from "./lib/runtime-control-service.mjs";
import { createBatchQueueRuntimeService } from "./lib/batch-queue-service.mjs";
import { createExecutionLaneRegistry } from "./lib/execution-lane.mjs";
import { createPageSessionRegistry } from "./lib/page-session.mjs";
import { createResolvePromptState } from "./lib/prompt-settlement.mjs";
import {
  ComfyOutputPathError,
  isMp4Filename,
  resolveAuthoritativeComfyOutput
} from "./lib/comfy-output-authority.mjs";
import { showComfyOutputInFolder } from "./lib/comfy-output-actions.mjs";
import { submitWorkflowToComfy } from "./lib/queue-submit.mjs";
import { resolveBatchItemFiles } from "./lib/batch-draft.mjs";
import { extractPromptIdFromQueueEntry } from "./lib/comfy-queue.mjs";

function resolveConfiguredFilesystemPath(baseRoot, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(baseRoot, raw);
}

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = resolveConfigPath({ root, env: process.env, existsSync });
const config = JSON.parse(await readFile(configPath, "utf8"));
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const comfy = config.comfyUrl.replace(/\/$/, "");
const workflowDir = path.resolve(root, config.workflowDirectory || "./workflows");
const projectDir = path.resolve(root, config.projectDirectory || "./projects");
/**
 * Output root precedence:
 * 1) explicit harness config.comfyOutputDirectory
 * 2) H3_COMFY_OUTPUT_DIRECTORY (Windows launcher derives <comfyRoot>/ComfyUI/output)
 */
const comfyOutputDirectory = resolveConfiguredFilesystemPath(root, config.comfyOutputDirectory)
  || resolveConfiguredFilesystemPath(root, process.env.H3_COMFY_OUTPUT_DIRECTORY);
const projectStore = createProjectStore(projectDir);
const logger = createLogger(path.join(root, "logs", "harness.log"));
const runtimeOwnership = createRuntimeOwnershipRegistry();
const pageSessions = createPageSessionRegistry();
/** Browser-independent settlement for abandoned ACTIVE/IMMEDIATE accepted prompts. */
const resolvePromptState = createResolvePromptState({ comfyUrl: comfy });
const executionLane = createExecutionLaneRegistry({ pageSessions, resolvePromptState });
/** Periodic settle — independent of browser SSE; never submits /prompt. */
const abandonedPromptSettleTimer = setInterval(() => {
  executionLane.settleAbandonedAcceptedPrompts().catch(() => {});
}, 5_000);
if (typeof abandonedPromptSettleTimer.unref === "function") abandonedPromptSettleTimer.unref();
const runtimeControl = createRuntimeControlService({
  comfyUrl: comfy,
  ownershipRegistry: runtimeOwnership,
  logger
});

const batchQueueRuntime = createBatchQueueRuntimeService({
  submitJob: async (input, meta = {}) => {
    const { preset, workflow } = await loadPreset(input.workflowId);
    const files = resolveBatchItemFiles(
      { files: input.files },
      input.sharedFiles || {}
    );
    const result = await submitWorkflowToComfy({
      input: { ...input, files },
      preset,
      workflow,
      comfyUrl: comfy
    });
    if (!result.ok || !result.data?.prompt_id) {
      const error = new Error(result.data?.error || "Queue submission failed");
      error.status = result.status || 502;
      throw error;
    }
    return result.data;
  },
  fetchQueueCounts: async () => {
    const response = await fetch(`${comfy}/queue`);
    const data = await response.json();
    return {
      running: Array.isArray(data.queue_running) ? data.queue_running.length : 0,
      pending: Array.isArray(data.queue_pending) ? data.queue_pending.length : 0
    };
  },
  fetchHistoryState: async promptId => {
    try {
      const response = await fetch(`${comfy}/history/${encodeURIComponent(promptId)}`);
      if (!response.ok) return "running";
      const data = await response.json();
      const entry = data[promptId];
      if (!entry) return "running";
      const messages = entry.status?.messages || [];
      const types = messages.map(item => item[0]);
      if (types.includes("execution_success")) return "completed";
      if (types.includes("execution_interrupted")) return "interrupted";
      if (types.includes("execution_error")) return "failed";
      return "running";
    } catch {
      return "running";
    }
  },
  fetchActivePromptId: async () => {
    const response = await fetch(`${comfy}/queue`);
    const data = await response.json();
    const running = Array.isArray(data.queue_running) ? data.queue_running : [];
    return running.length ? extractPromptIdFromQueueEntry(running[0]) : null;
  },
  registerOwnership: ({ promptId, batchId, batchIndex, queueRunId, queueEntryId }) => {
    runtimeOwnership.register(promptId, {
      kind: "batch",
      batchId,
      batchIndex,
      clientId: queueRunId,
      queueEntryId
    });
  },
  executionLane,
  persistDescriptivePlan: async ({ projectId, plan }) => {
    if (!projectId || !plan) return;
    try {
      // Patch-only: projectStore.update() re-reads fresh state and must not
      // overwrite unrelated editor fields with a stale full snapshot.
      await projectStore.update(projectId, { batchQueue: plan });
    } catch (error) {
      logger?.error?.("batch_queue_checkpoint_failed", {
        project_id: String(projectId).slice(0, 8),
        reason: error.message
      });
      throw error;
    }
  },
  logger
});

const json = (res, status, body) => sendJson(res, status, body);
const body = async req => { const chunks=[]; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };
const shortId = value => value ? String(value).slice(0, 8) : undefined;
const readJsonBody = async req => {
  const text = (await body(req)).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Malformed JSON body");
    error.status = 400;
    throw error;
  }
};

async function checkComfyReachable() {
  try {
    const upstream = await fetch(`${comfy}/queue`);
    logger.info(upstream.ok ? "comfy_reachable" : "comfy_unreachable", { status: upstream.status });
  } catch {
    logger.error("comfy_unreachable", { reason: "fetch_failed" });
  }
}

async function presets() {
  const files = (await readdir(workflowDir)).filter(x => x.endsWith(".preset.json"));
  return Promise.all(files.map(async file => {
    const preset = JSON.parse(await readFile(path.join(workflowDir, file), "utf8"));
    let safeFit = {
      status: "not-applicable",
      mode: preset.mode || null,
      reason: "workflow_unavailable",
      blocksGenerate: false
    };
    try {
      const workflowPath = path.join(workflowDir, preset.workflow);
      if (existsSync(workflowPath)) {
        const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
        safeFit = publicSafeFitSummary(inspectH3SafeFit(workflow, { mode: preset.mode }));
      } else if (["I2VA", "FL2VA"].includes(String(preset.mode || "").toUpperCase())) {
        safeFit = {
          status: "unexpected",
          mode: preset.mode,
          reason: "workflow_file_missing",
          blocksGenerate: true
        };
      }
    } catch {
      if (["I2VA", "FL2VA"].includes(String(preset.mode || "").toUpperCase())) {
        safeFit = {
          status: "unexpected",
          mode: preset.mode,
          reason: "workflow_inspect_failed",
          blocksGenerate: true
        };
      }
    }
    return { ...preset, presetFile: file, safeFit };
  }));
}

async function projects() {
  return projectStore.list();
}

async function assetStatuses(descriptors = []) {
  return probeAssetStatuses(descriptors, { comfyUrl: comfy });
}

async function loadPreset(id) {
  const preset = (await presets()).find(x => x.id === id);
  if (!preset) throw new Error(`Unknown workflow preset: ${id}`);
  const workflow = JSON.parse(await readFile(path.join(workflowDir, preset.workflow), "utf8"));
  return { preset, workflow };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        version: packageInfo.version,
        comfyUrl: comfy,
        wsUrl: comfy.replace(/^http/, "ws") + "/ws",
        presets: await presets(),
        projects: await projects(),
        comfyOutputConfigured: Boolean(comfyOutputDirectory)
      });
    }
    if (req.method === "GET" && url.pathname === "/api/projects") return json(res, 200, await projects());
    if (req.method === "POST" && url.pathname === "/api/projects") {
      const input = await readJsonBody(req);
      if (!input.label || !String(input.label).trim()) return json(res, 400, { error: "Project label required" });
      const created = await projectStore.create(input);
      logger.info("project_create", { project_id: created.id });
      return json(res, 201, created);
    }
    {
      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(duplicate))?$/);
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        const action = projectMatch[2];
        if (!isValidProjectId(projectId)) return json(res, 400, { error: "Invalid project id" });
        try {
          if (req.method === "GET" && !action) return json(res, 200, await projectStore.read(projectId));
          if (req.method === "PUT" && !action) {
            const input = await readJsonBody(req);
            const updated = await projectStore.update(projectId, input);
            logger.info("project_update", { project_id: projectId });
            return json(res, 200, updated);
          }
          if (req.method === "POST" && action === "duplicate") {
            const input = await readJsonBody(req);
            if (!input.label || !String(input.label).trim()) return json(res, 400, { error: "New project label required" });
            const duplicated = await projectStore.duplicate(projectId, { label: input.label, newId: input.id });
            logger.info("project_duplicate", { project_id: projectId, new_id: duplicated.id });
            return json(res, 201, duplicated);
          }
          if (req.method === "DELETE" && !action) {
            await projectStore.remove(projectId);
            logger.info("project_delete", { project_id: projectId });
            return json(res, 200, { ok: true, id: projectId });
          }
        } catch (error) {
          return json(res, error.status || 500, { error: error.message });
        }
      }
    }
    if (req.method === "GET" && url.pathname === "/api/asset-status") {
      return json(res, 200, { statuses: await assetStatuses(parseAssetStatusDescriptors(url.searchParams)) });
    }
    if (req.method === "GET" && url.pathname === "/api/gpu-power") {
      const [status, helper] = await Promise.all([readGpuPowerStatus(), readGpuHelperState()]);
      return json(res, 200, { ...gpuPowerPublicPayload(status), helper: gpuHelperPublicPayload(helper) });
    }
    if (req.method === "POST" && url.pathname === "/api/gpu-power") {
      let input;
      try {
        input = await readJsonBody(req);
      } catch (error) {
        return json(res, error.status || 400, { error: error.message, code: "invalid-json" });
      }
      if (input == null || typeof input !== "object" || Array.isArray(input)) {
        return json(res, 400, { error: "Invalid GPU power body.", code: "invalid-mode" });
      }
      const keys = Object.keys(input);
      if (keys.length !== 1 || keys[0] !== "mode" || typeof input.mode !== "string") {
        return json(res, 400, { error: "Invalid GPU power mode.", code: "invalid-mode" });
      }
      try {
        const result = await applyGpuPowerMode(input.mode);
        logger.info("gpu_power_set", { mode: input.mode, watts: result.requested.watts });
        return json(res, 200, {
          ok: true,
          requested: result.requested,
          ...gpuPowerPublicPayload(result.status),
          ...(result.helper ? { helper: result.helper } : {})
        });
      } catch (error) {
        if (error instanceof GpuPowerError) {
          logger.error("gpu_power_set_failed", { mode: input.mode, code: error.code, reason: error.message });
          return json(res, error.status || 500, { error: error.message, code: error.code });
        }
        logger.error("gpu_power_set_failed", { mode: input.mode, reason: error.message });
        return json(res, 500, { error: error.message, code: "gpu-power-error" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/runtime/ownership") {
      const promptId = url.searchParams.get("promptId") || "";
      const batchId = url.searchParams.get("batchId") || "";
      return json(res, 200, runtimeControl.getOwnershipQuery({
        promptId: promptId || undefined,
        batchId: batchId || undefined
      }));
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/interrupt-single") {
      try {
        const input = await readJsonBody(req);
        const result = await runtimeControl.interruptSingle({ expectedPromptId: input.expectedPromptId });
        return json(res, 200, result);
      } catch (error) {
        logger.error("runtime_interrupt_rejected", { scope: "single", code: error.code, reason: error.message });
        return json(res, error.status || 409, { error: error.message, code: error.code || "interrupt-rejected" });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/interrupt-batch-current") {
      try {
        const input = await readJsonBody(req);
        const result = await runtimeControl.interruptBatchCurrent({
          batchId: input.batchId,
          expectedPromptId: input.expectedPromptId
        });
        return json(res, 200, result);
      } catch (error) {
        logger.error("runtime_interrupt_rejected", { scope: "batch-current", code: error.code, reason: error.message });
        return json(res, error.status || 409, { error: error.message, code: error.code || "interrupt-rejected" });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/stop-batch") {
      try {
        const input = await readJsonBody(req);
        const result = await runtimeControl.stopBatch({
          batchId: input.batchId,
          expectedRunningPromptId: input.expectedRunningPromptId
        });
        let queueCheckpoint = null;
        if (input.projectId) {
          queueCheckpoint = await batchQueueRuntime.onFullBatchStop(input.projectId, { batchId: input.batchId });
        }
        return json(res, 200, {
          ...result,
          queueCheckpoint,
          queueCheckpointFailed: Boolean(queueCheckpoint && queueCheckpoint.ok === false)
        });
      } catch (error) {
        logger.error("batch_stop_rejected", { code: error.code, reason: error.message });
        return json(res, error.status || 409, { error: error.message, code: error.code || "batch-stop-rejected" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/execution-lane") {
      return json(res, 200, { reservation: executionLane.get() });
    }
    if (req.method === "POST" && url.pathname === "/api/execution-lane/reserve") {
      const input = await readJsonBody(req);
      const result = await executionLane.reserve({
        kind: input.kind,
        ownerId: input.ownerId,
        projectId: input.projectId,
        pageSessionId: input.pageSessionId
      });
      return json(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && url.pathname === "/api/execution-lane/release") {
      const input = await readJsonBody(req);
      const result = executionLane.release({
        ownerId: input.ownerId,
        kind: input.kind,
        leaseToken: input.leaseToken,
        pageSessionId: input.pageSessionId
      });
      return json(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && url.pathname === "/api/execution-lane/transfer") {
      const input = await readJsonBody(req);
      const result = executionLane.transferKind({
        ownerId: input.ownerId,
        kind: input.kind,
        leaseToken: input.leaseToken,
        pageSessionId: input.pageSessionId
      });
      return json(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && url.pathname === "/api/execution-lane/heartbeat") {
      const input = await readJsonBody(req);
      const result = executionLane.heartbeat({
        ownerId: input.ownerId,
        leaseToken: input.leaseToken,
        pageSessionId: input.pageSessionId
      });
      return json(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && url.pathname === "/api/execution-lane/reclaim-stale") {
      const input = await readJsonBody(req);
      // staleAfterMs from clients is intentionally ignored — server policy only.
      const result = await executionLane.reclaimStale({
        requesterId: input.requesterId
      });
      return json(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "GET" && url.pathname === "/api/batch-queue/runtime") {
      const projectId = url.searchParams.get("projectId") || "";
      return json(res, 200, batchQueueRuntime.getRuntime(projectId));
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/sync") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.syncPlan({
        projectId: input.projectId,
        plan: input.plan,
        expectedRevision: input.expectedRevision
      });
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/arm") {
      const input = await readJsonBody(req);
      const result = await batchQueueRuntime.arm({
        projectId: input.projectId,
        plan: input.plan,
        failurePolicy: input.failurePolicy
      });
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/resume") {
      const input = await readJsonBody(req);
      const result = await batchQueueRuntime.resume({
        projectId: input.projectId,
        plan: input.plan,
        expectedRevision: input.expectedRevision
      });
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/resolve-recovery") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.resolveRecoveryEntry(input);
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/update-entry") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.updateEntry(input);
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/reorder") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.reorder(input);
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/cancel-entry") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.cancelEntry(input);
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "POST" && url.pathname === "/api/batch-queue/pause") {
      const input = await readJsonBody(req);
      const result = batchQueueRuntime.pauseQueue({ projectId: input.projectId, reason: input.reason });
      if (!result.ok) return json(res, 409, result);
      return json(res, 200, result.view);
    }
    if (req.method === "GET" && url.pathname === "/api/active") {
      try {
        const upstream = await fetch(`${comfy}/queue`);
        const queue = await upstream.json();
        if (!upstream.ok) {
          logger.error("active_fetch", { status: upstream.status });
          return json(res, upstream.status, queue);
        }
        const runningCount = Array.isArray(queue.queue_running) ? queue.queue_running.length : 0;
        const pendingCount = Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0;
        const running = queue.queue_running?.[0];
        if (running) {
          logger.info("job_recovery", { prompt_id: shortId(running[1]), client_id: shortId(running[3]?.client_id) });
          return json(res, upstream.status, {
            active: true,
            promptId: running[1],
            clientId: running[3]?.client_id,
            createdAt: running[3]?.create_time,
            running: runningCount,
            pending: pendingCount
          });
        }
        return json(res, upstream.status, { active: false, running: runningCount, pending: pendingCount });
      } catch (error) {
        logger.error("active_fetch", { reason: error.message });
        return json(res, 502, { error: "Failed to query ComfyUI queue" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/comfy-logs") {
      try {
        const upstream = await fetch(`${comfy}/internal/logs/raw`);
        if (!upstream.ok) {
          logger.error("comfy_logs_fetch", { status: upstream.status });
          return json(res, upstream.status, { available: false, error: "ComfyUI log API unavailable", entries: [] });
        }
        const data = await upstream.json();
        return json(res, 200, { available: true, entries: data.entries || [], size: data.size || null });
      } catch (error) {
        logger.error("comfy_logs_fetch", { reason: error.message });
        return json(res, 502, { available: false, error: "ComfyUI log API unreachable", entries: [] });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return json(res, 400, { error: "Missing clientId" });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      // pageInstanceId is a memory-only document reconnect nonce, not the authority.
      // Same instance reattaches the same opaque pageSessionId; never accept client pageSessionId.
      const attached = pageSessions.attach(url.searchParams.get("pageInstanceId"));
      const pageSessionId = attached.pageSessionId;
      const connectionGeneration = attached.connectionGeneration;
      res.write(": connected\n\n");
      res.write(`event: page-session\ndata: ${JSON.stringify({
        pageSessionId,
        reattached: Boolean(attached.reattached)
      })}\n\n`);
      logger.info("sse_bridge_open", {
        client_id: shortId(clientId),
        page_session: shortId(pageSessionId),
        reattached: Boolean(attached.reattached)
      });
      const upstream = new WebSocket(`${comfy.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
      const sendEvent = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      const subscribeLogs = async enabled => {
        try {
          await fetch(`${comfy}/internal/logs/subscribe`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, enabled: Boolean(enabled) })
          });
        } catch {
          // Optional capability; progress monitoring still works without live log push.
        }
      };
      upstream.addEventListener("open", () => {
        sendEvent("connection", { state: "open" });
        subscribeLogs(true);
      });
      upstream.addEventListener("message", event => {
        if (typeof event.data === "string" && !res.destroyed) {
          executionLane.noteComfyMessage(event.data);
          res.write(`data: ${event.data}\n\n`);
        }
      });
      upstream.addEventListener("close", () => {
        logger.info("sse_bridge_close", { client_id: shortId(clientId), page_session: shortId(pageSessionId) });
        subscribeLogs(false);
        sendEvent("connection", { state: "closed" });
      });
      upstream.addEventListener("error", () => {
        logger.error("sse_bridge_error", { client_id: shortId(clientId), page_session: shortId(pageSessionId) });
        sendEvent("connection", { state: "error" });
      });
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        pageSessions.close(pageSessionId, connectionGeneration);
        subscribeLogs(false);
        if (upstream.readyState < 2) upstream.close();
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/upload") {
      const raw = await body(req);
      try {
        const upstream = await fetch(`${comfy}/upload/image`, { method: "POST", headers: { "content-type": req.headers["content-type"] || "application/octet-stream" }, body: raw.length ? raw : undefined });
        if (!upstream.ok) {
          logger.error("upload_failed", { status: upstream.status });
        } else {
          logger.info("upload_ok", { status: upstream.status });
        }
        await sendBufferedUpstream(res, upstream);
      } catch (error) {
        logger.error("upload_failed", { reason: error.message });
        json(res, 502, { error: "Upload failed" });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      const id = encodeURIComponent(url.searchParams.get("promptId") || "");
      try {
        const upstream = await fetch(`${comfy}/history/${id}`);
        const data = await upstream.json();
        if (!upstream.ok) logger.error("history_fetch", { status: upstream.status, prompt_id: shortId(url.searchParams.get("promptId")) });
        return json(res, upstream.status, data);
      } catch (error) {
        logger.error("history_fetch", { reason: error.message, prompt_id: shortId(url.searchParams.get("promptId")) });
        return json(res, 502, { error: "History fetch failed" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/view") {
      try {
        const upstream = await fetch(`${comfy}/view?${url.searchParams}`);
        await sendBufferedUpstream(res, upstream);
      } catch (error) {
        logger.error("view_fetch", { reason: error.message });
        json(res, 502, { error: "View fetch failed" });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/show-in-folder") {
      let input;
      try {
        input = await readJsonBody(req);
      } catch (error) {
        return json(res, error.status || 400, { error: error.message, code: "invalid-json" });
      }
      try {
        const result = await showComfyOutputInFolder({
          outputRoot: comfyOutputDirectory,
          comfyUrl: comfy,
          promptId: input.promptId,
          filename: input.filename,
          subfolder: input.subfolder || "",
          type: input.type || "output"
        });
        logger.info("show_in_folder", {
          prompt_id: shortId(input.promptId),
          filename: String(input.filename || "").slice(0, 64)
        });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof ComfyOutputPathError) {
          return json(res, error.status || 400, { error: error.message, code: error.code });
        }
        logger.error("show_in_folder", { reason: error.message });
        return json(res, 500, { error: "Show in folder failed", code: "show-in-folder-failed" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/download-mp4") {
      try {
        const filename = url.searchParams.get("filename") || "";
        const subfolder = url.searchParams.get("subfolder") || "";
        const promptId = url.searchParams.get("promptId") || "";
        if (!isMp4Filename(filename)) {
          return json(res, 400, {
            error: "Only authoritative .mp4 outputs can use Scarica MP4.",
            code: "not-mp4"
          });
        }
        const resolved = await resolveAuthoritativeComfyOutput({
          outputRoot: comfyOutputDirectory,
          comfyUrl: comfy,
          promptId,
          filename,
          subfolder,
          type: "output"
        });
        const info = await stat(resolved.absolutePath);
        if (!info.isFile()) {
          return json(res, 404, { error: "Output file not found.", code: "file-not-found" });
        }
        res.writeHead(200, {
          "content-type": "video/mp4",
          "content-disposition": `attachment; filename="${resolved.filename.replace(/"/g, "")}"`,
          "content-length": String(info.size),
          "cache-control": "no-store"
        });
        createReadStream(resolved.absolutePath).pipe(res);
        return;
      } catch (error) {
        if (error instanceof ComfyOutputPathError) {
          return json(res, error.status || 400, { error: error.message, code: error.code });
        }
        if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
          return json(res, 404, { error: "Output file not found.", code: "file-not-found" });
        }
        logger.error("download_mp4", { reason: error.message });
        return json(res, 500, { error: "Download failed", code: "download-failed" });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/queue") {
      const laneOwner = String(req.headers["x-h3-lane-owner"] || "").trim();
      const laneKind = String(req.headers["x-h3-lane-kind"] || "").trim() || null;
      const laneLease = String(req.headers["x-h3-lane-lease"] || "").trim() || null;
      const lanePageSession = String(req.headers["x-h3-page-session"] || "").trim() || null;
      const laneGate = executionLane.assertSubmitAllowed({
        ownerId: laneOwner || null,
        kind: laneKind,
        leaseToken: laneLease,
        pageSessionId: lanePageSession
      });
      if (!laneGate.ok) {
        logger.error("queue_rejected", { reason: "execution_lane", code: laneGate.code });
        return json(res, 409, {
          error: laneGate.error,
          code: laneGate.code || "lane-busy",
          reservation: laneGate.reservation || null
        });
      }
      // Bind bookkeeping to this reservation generation so a late completion
      // cannot mutate a later unrelated reservation.
      const submitBinding = {
        generation: laneGate.generation,
        leaseToken: laneGate.leaseToken
      };
      executionLane.beginSubmitTransaction(submitBinding);
      try {
        const input = JSON.parse((await body(req)).toString("utf8"));
        logger.info("queue_submit", { workflow: input.workflowId, client_id: shortId(input.clientId) });
        const { preset, workflow } = await loadPreset(input.workflowId);
        const fit = inspectH3SafeFit(workflow, { mode: preset.mode });
        if (safeFitBlocksGenerate(fit.status)) {
          const gate = describeSafeFitBlocker(fit.status);
          logger.error("queue_rejected", { workflow: input.workflowId, reason: "safe_fit_blocked", status: fit.status });
          return json(res, 409, { error: gate.reason, safeFit: publicSafeFitSummary(fit) });
        }
        let requested;
        try {
          requested = selectMegapixels(input);
        } catch (error) {
          logger.error("queue_rejected", { workflow: input.workflowId, reason: "invalid_megapixels" });
          return json(res, 400, { error: error.message });
        }
        const { aspectRatio, megapixels } = resolutionSettings(input.aspect, requested);
        const values = { prompt: input.prompt, model: input.model, steps: Number(input.steps), duration: Number(input.duration), seed: Number(input.seed), aspectRatio, megapixels, firstImage: input.firstImage, lastImage: input.lastImage, ...(input.files || {}) };
        const bound = cloneAndBind(workflow, preset.bindings || {}, values);
        try {
          const upstream = await fetch(`${comfy}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: bound, client_id: input.clientId }) });
          const data = await upstream.json();
          if (!upstream.ok || !data.prompt_id) {
            logger.error("queue_rejected", { workflow: input.workflowId, status: upstream.status });
          } else {
            executionLane.notePromptAccepted(data.prompt_id, submitBinding);
            const batchId = req.headers["x-h3-batch-id"];
            const batchIndexRaw = req.headers["x-h3-batch-index"];
            runtimeControl.registerQueueAcceptance({
              promptId: data.prompt_id,
              batchId: batchId ? String(batchId) : null,
              batchIndex: batchIndexRaw != null && batchIndexRaw !== "" ? Number(batchIndexRaw) : null,
              clientId: input.clientId
            });
            logger.info("queue_accepted", { workflow: input.workflowId, prompt_id: shortId(data.prompt_id) });
          }
          return json(res, upstream.status, data);
        } catch (error) {
          logger.error("queue_rejected", { workflow: input.workflowId, reason: error.message });
          return json(res, 502, { error: "Queue submission failed" });
        }
      } finally {
        executionLane.endSubmitTransaction(submitBinding);
      }
    }
    if (req.method === "GET" && url.pathname === "/api/outputs") {
      const promptId = url.searchParams.get("promptId") || "";
      const id = encodeURIComponent(promptId);
      try {
        const upstream = await fetch(`${comfy}/history/${id}`);
        const data = await upstream.json();
        if (!upstream.ok) {
          logger.error("outputs_fetch", { status: upstream.status, prompt_id: shortId(promptId) });
          return json(res, upstream.status, data);
        }
        return json(res, upstream.status, collectOutputs(data[id], `http://${req.headers.host}`));
      } catch (error) {
        logger.error("outputs_fetch", { reason: error.message, prompt_id: shortId(promptId) });
        return json(res, 502, { error: "Output retrieval failed" });
      }
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const publicRoot = path.resolve(root, "public");
    const libRoot = path.resolve(root, "lib");
    let target;
    if (relative.startsWith("lib/")) {
      target = path.resolve(root, relative);
      if (!target.startsWith(libRoot) || !existsSync(target) || !target.endsWith(".mjs")) return json(res, 404, { error: "Not found" });
    } else {
      target = path.resolve(publicRoot, relative);
      if (!target.startsWith(publicRoot) || !existsSync(target)) return json(res, 404, { error: "Not found" });
    }
    const staticContentType = filePath => {
      if (filePath.endsWith(".css")) return "text/css";
      if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript";
      return "text/html";
    };
    const type = staticContentType(target);
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    attachSafeStaticStream(res, createReadStream(target), logger, relative);
  } catch (error) {
    if (!canWriteResponse(res)) {
      logger.error("request_failed_late", {
        path: req.url,
        reason: error.message,
        headers_sent: Boolean(res?.headersSent),
        writable_ended: Boolean(res?.writableEnded),
        destroyed: Boolean(res?.destroyed)
      });
      endStartedResponse(res);
      return;
    }
    logger.error("request_failed", { path: req.url, reason: error.message });
    json(res, 500, { error: error.message });
  }
});

server.listen(config.listenPort, config.listenHost, () => {
  console.log(`H3 harness: http://${config.listenHost}:${config.listenPort}`);
  logger.info("harness_start", { version: packageInfo.version, comfy_url: comfy, host: config.listenHost, port: config.listenPort });
  checkComfyReachable();
});
