import http from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneAndBind, dimensions, resolutionSettings, collectOutputs } from "./lib/workflow.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(root, "config.json");
const config = JSON.parse(await readFile(existsSync(configPath) ? configPath : path.join(root, "config.example.json"), "utf8"));
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const comfy = config.comfyUrl.replace(/\/$/, "");
const workflowDir = path.resolve(root, config.workflowDirectory || "./workflows");
const projectDir = path.resolve(root, config.projectDirectory || "./projects");

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const body = async req => { const chunks=[]; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };

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

async function proxy(req, res, pathname) {
  const raw = await body(req);
  const upstream = await fetch(comfy + pathname, { method: req.method, headers: { "content-type": req.headers["content-type"] || "application/octet-stream" }, body: raw.length ? raw : undefined });
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/octet-stream" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, { version: packageInfo.version, comfyUrl: comfy, wsUrl: comfy.replace(/^http/, "ws") + "/ws", presets: await presets(), projects: await projects() });
    if (req.method === "GET" && url.pathname === "/api/active") {
      const upstream = await fetch(`${comfy}/queue`); const queue = await upstream.json();
      const running = queue.queue_running?.[0];
      return json(res, upstream.status, running ? { active: true, promptId: running[1], clientId: running[3]?.client_id, createdAt: running[3]?.create_time } : { active: false });
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return json(res, 400, { error: "Missing clientId" });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      const upstream = new WebSocket(`${comfy.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
      const sendEvent = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      upstream.addEventListener("open", () => sendEvent("connection", { state: "open" }));
      upstream.addEventListener("message", event => { if (typeof event.data === "string" && !res.destroyed) res.write(`data: ${event.data}\n\n`); });
      upstream.addEventListener("close", () => sendEvent("connection", { state: "closed" }));
      upstream.addEventListener("error", () => sendEvent("connection", { state: "error" }));
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 15000);
      req.on("close", () => { clearInterval(heartbeat); if (upstream.readyState < 2) upstream.close(); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/upload") return proxy(req, res, "/upload/image");
    if (req.method === "GET" && url.pathname === "/api/history") {
      const id = encodeURIComponent(url.searchParams.get("promptId") || "");
      const upstream = await fetch(`${comfy}/history/${id}`); return json(res, upstream.status, await upstream.json());
    }
    if (req.method === "GET" && url.pathname === "/api/view") {
      const upstream = await fetch(`${comfy}/view?${url.searchParams}`);
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/octet-stream" }); return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if (req.method === "POST" && url.pathname === "/api/queue") {
      const input = JSON.parse((await body(req)).toString("utf8"));
      const { preset, workflow } = await loadPreset(input.workflowId);
      const [width, height] = dimensions(input.aspect, input.quality);
      const { aspectRatio, megapixels } = resolutionSettings(input.aspect, input.quality);
      const values = { prompt: input.prompt, model: input.model, steps: Number(input.steps), duration: Number(input.duration), seed: Number(input.seed), width, height, aspectRatio, megapixels, firstImage: input.firstImage, lastImage: input.lastImage, ...(input.files || {}) };
      const bound = cloneAndBind(workflow, preset.bindings || {}, values);
      const upstream = await fetch(`${comfy}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: bound, client_id: input.clientId }) });
      return json(res, upstream.status, await upstream.json());
    }
    if (req.method === "GET" && url.pathname === "/api/outputs") {
      const id = encodeURIComponent(url.searchParams.get("promptId") || "");
      const upstream = await fetch(`${comfy}/history/${id}`); const data = await upstream.json();
      return json(res, upstream.status, collectOutputs(data[id], `http://${req.headers.host}`));
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const target = path.resolve(root, "public", relative);
    if (!target.startsWith(path.resolve(root, "public")) || !existsSync(target)) return json(res, 404, { error: "Not found" });
    const type = target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); createReadStream(target).pipe(res);
  } catch (error) { json(res, 500, { error: error.message }); }
});

server.listen(config.listenPort, config.listenHost, () => console.log(`H3 harness: http://${config.listenHost}:${config.listenPort}`));
