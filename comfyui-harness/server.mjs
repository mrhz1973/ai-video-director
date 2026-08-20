import http from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneAndBind, resolutionSettings, selectMegapixels, collectOutputs } from "./lib/workflow.mjs";
import { createLogger } from "./lib/logger.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(root, "config.json");
const config = JSON.parse(await readFile(existsSync(configPath) ? configPath : path.join(root, "config.example.json"), "utf8"));
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const comfy = config.comfyUrl.replace(/\/$/, "");
const workflowDir = path.resolve(root, config.workflowDirectory || "./workflows");
const projectDir = path.resolve(root, config.projectDirectory || "./projects");
const logger = createLogger(path.join(root, "logs", "harness.log"));

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const body = async req => { const chunks=[]; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };
const shortId = value => value ? String(value).slice(0, 8) : undefined;

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
    return { ...preset, presetFile: file };
  }));
}

async function projects() {
  await mkdir(projectDir, { recursive: true });
  const files = (await readdir(projectDir)).filter(x => x.endsWith(".local.json"));
  const result = await Promise.all(files.map(file => readFile(path.join(projectDir, file), "utf8").then(JSON.parse)));
  return result.sort((a, b) => String(a.label).localeCompare(String(b.label), "it"));
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
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, { version: packageInfo.version, comfyUrl: comfy, wsUrl: comfy.replace(/^http/, "ws") + "/ws", presets: await presets(), projects: await projects() });
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
      res.write(": connected\n\n");
      logger.info("sse_bridge_open", { client_id: shortId(clientId) });
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
      upstream.addEventListener("message", event => { if (typeof event.data === "string" && !res.destroyed) res.write(`data: ${event.data}\n\n`); });
      upstream.addEventListener("close", () => {
        logger.info("sse_bridge_close", { client_id: shortId(clientId) });
        subscribeLogs(false);
        sendEvent("connection", { state: "closed" });
      });
      upstream.addEventListener("error", () => {
        logger.error("sse_bridge_error", { client_id: shortId(clientId) });
        sendEvent("connection", { state: "error" });
      });
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
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
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/octet-stream" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
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
      const upstream = await fetch(`${comfy}/view?${url.searchParams}`);
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/octet-stream" }); return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if (req.method === "POST" && url.pathname === "/api/queue") {
      const input = JSON.parse((await body(req)).toString("utf8"));
      logger.info("queue_submit", { workflow: input.workflowId, client_id: shortId(input.clientId) });
      const { preset, workflow } = await loadPreset(input.workflowId);
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
          logger.info("queue_accepted", { workflow: input.workflowId, prompt_id: shortId(data.prompt_id) });
        }
        return json(res, upstream.status, data);
      } catch (error) {
        logger.error("queue_rejected", { workflow: input.workflowId, reason: error.message });
        return json(res, 502, { error: "Queue submission failed" });
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
    const target = path.resolve(root, "public", relative);
    if (!target.startsWith(path.resolve(root, "public")) || !existsSync(target)) return json(res, 404, { error: "Not found" });
    const staticContentType = filePath => {
      if (filePath.endsWith(".css")) return "text/css";
      if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript";
      return "text/html";
    };
    const type = staticContentType(target);
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); createReadStream(target).pipe(res);
  } catch (error) {
    logger.error("request_failed", { path: req.url, reason: error.message });
    json(res, 500, { error: error.message });
  }
});

server.listen(config.listenPort, config.listenHost, () => {
  console.log(`H3 harness: http://${config.listenHost}:${config.listenPort}`);
  logger.info("harness_start", { version: packageInfo.version, comfy_url: comfy, host: config.listenHost, port: config.listenPort });
  checkComfyReachable();
});
