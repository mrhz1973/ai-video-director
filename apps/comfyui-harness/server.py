from __future__ import annotations

import copy
import json
import mimetypes
import os
import urllib.parse
import uuid
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket
from fastapi.responses import FileResponse, Response

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("COMFY_HARNESS_CONFIG", BASE_DIR / "config.json"))
EXAMPLE_CONFIG_PATH = BASE_DIR / "config.example.json"
INDEX_PATH = BASE_DIR / "static" / "index.html"

app = FastAPI(title="AI Video Director - ComfyUI Harness", version="0.1.0")


def load_config() -> dict[str, Any]:
    path = CONFIG_PATH if CONFIG_PATH.exists() else EXAMPLE_CONFIG_PATH
    if not path.exists():
        raise RuntimeError("Missing config.json and config.example.json")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def resolve_workflow_file(file_name: str) -> Path:
    path = (BASE_DIR / file_name).resolve()
    try:
        path.relative_to(BASE_DIR)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Workflow path escapes harness directory") from exc
    if not path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Workflow file not found: {file_name}. Export it from ComfyUI in API JSON format.",
        )
    return path


def set_dotted_path(document: dict[str, Any], dotted_path: str, value: Any) -> None:
    parts = dotted_path.split(".")
    cursor: Any = document
    for part in parts[:-1]:
        if not isinstance(cursor, dict) or part not in cursor:
            raise KeyError(dotted_path)
        cursor = cursor[part]
    if not isinstance(cursor, dict) or parts[-1] not in cursor:
        raise KeyError(dotted_path)
    cursor[parts[-1]] = value


def patch_binding(
    workflow: dict[str, Any],
    bindings: dict[str, Any],
    key: str,
    value: Any,
) -> None:
    path = bindings.get(key)
    if not path or value is None or value == "":
        return
    if not isinstance(path, str):
        raise HTTPException(status_code=400, detail=f"Binding '{key}' must be a dotted string path")
    try:
        set_dotted_path(workflow, path, value)
    except KeyError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Binding '{key}' points to missing workflow path: {path}",
        ) from exc


def comfy_urls(config: dict[str, Any]) -> tuple[str, str]:
    comfy = config.get("comfyui", {})
    http_url = str(comfy.get("http_url", "http://127.0.0.1:8188")).rstrip("/")
    ws_url = str(comfy.get("ws_url", "ws://127.0.0.1:8188/ws"))
    return http_url, ws_url


async def upload_image(http_url: str, upload: UploadFile) -> str:
    payload = await upload.read()
    if not payload:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {upload.filename}")

    files = {
        "image": (
            upload.filename or "input.png",
            payload,
            upload.content_type or "application/octet-stream",
        )
    }
    data = {"type": "input", "overwrite": "true"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(f"{http_url}/upload/image", files=files, data=data)
    if response.is_error:
        raise HTTPException(
            status_code=502,
            detail=f"ComfyUI upload failed: {response.status_code} {response.text[:500]}",
        )

    result = response.json()
    name = result.get("name") or result.get("filename") or upload.filename
    subfolder = result.get("subfolder") or ""
    if not name:
        raise HTTPException(status_code=502, detail="ComfyUI upload response did not contain a filename")
    return f"{subfolder}/{name}" if subfolder else str(name)


def collect_assets(history_entry: dict[str, Any]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    outputs = history_entry.get("outputs", {})

    for node_id, node_output in outputs.items():
        if not isinstance(node_output, dict):
            continue
        for output_key, value in node_output.items():
            if not isinstance(value, list):
                continue
            for item in value:
                if not isinstance(item, dict) or not item.get("filename"):
                    continue
                filename = str(item["filename"])
                subfolder = str(item.get("subfolder") or "")
                folder_type = str(item.get("type") or "output")
                identity = (filename, subfolder, folder_type)
                if identity in seen:
                    continue
                seen.add(identity)
                query = urllib.parse.urlencode(
                    {"filename": filename, "subfolder": subfolder, "type": folder_type}
                )
                assets.append(
                    {
                        "node_id": str(node_id),
                        "output_key": str(output_key),
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": folder_type,
                        "url": f"/api/view?{query}",
                    }
                )
    return assets


@app.get("/")
async def index() -> FileResponse:
    if not INDEX_PATH.exists():
        raise HTTPException(status_code=500, detail="static/index.html is missing")
    return FileResponse(INDEX_PATH)


@app.get("/api/config")
async def public_config() -> dict[str, Any]:
    config = load_config()
    workflows = config.get("workflows", {})
    return {
        "ui": config.get("ui", {}),
        "modes": list(workflows.keys()),
        "workflow_status": {
            mode: {
                "file": preset.get("file"),
                "exists": bool(preset.get("file"))
                and (BASE_DIR / str(preset.get("file"))).exists(),
                "image_slots": len(preset.get("bindings", {}).get("images", [])),
            }
            for mode, preset in workflows.items()
        },
    }


@app.get("/api/health")
async def health() -> dict[str, Any]:
    config = load_config()
    http_url, _ = comfy_urls(config)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{http_url}/system_stats")
        response.raise_for_status()
        return {"ok": True, "comfyui": http_url, "system_stats": response.json()}
    except Exception as exc:
        return {"ok": False, "comfyui": http_url, "error": str(exc)}


@app.post("/api/run")
async def run_workflow(
    mode: str = Form(...),
    prompt: str = Form(...),
    model: str = Form(""),
    quality: str = Form(""),
    steps: int = Form(30),
    duration: int = Form(5),
    aspect: str = Form("16:9"),
    seed: int = Form(123456789),
    files: list[UploadFile] = File(default=[]),
) -> dict[str, Any]:
    config = load_config()
    workflows = config.get("workflows", {})
    if mode not in workflows:
        raise HTTPException(status_code=400, detail=f"Unknown workflow mode: {mode}")

    preset = workflows[mode]
    workflow_file = resolve_workflow_file(str(preset.get("file", "")))
    with workflow_file.open("r", encoding="utf-8") as handle:
        workflow = copy.deepcopy(json.load(handle))

    bindings = preset.get("bindings", {})
    image_bindings = bindings.get("images", []) or []
    if not isinstance(image_bindings, list):
        raise HTTPException(status_code=400, detail="bindings.images must be an array")

    expected_images = len(image_bindings)
    if expected_images != len(files):
        raise HTTPException(
            status_code=400,
            detail=f"{mode} expects {expected_images} image attachment(s); received {len(files)}.",
        )

    http_url, _ = comfy_urls(config)
    uploaded_names: list[str] = []
    for upload in files:
        uploaded_names.append(await upload_image(http_url, upload))

    patch_binding(workflow, bindings, "prompt", prompt)
    patch_binding(workflow, bindings, "model", model)
    patch_binding(workflow, bindings, "quality", quality)
    patch_binding(workflow, bindings, "steps", steps)
    patch_binding(workflow, bindings, "duration", duration)
    patch_binding(workflow, bindings, "aspect", aspect)
    patch_binding(workflow, bindings, "seed", seed)

    for path, uploaded_name in zip(image_bindings, uploaded_names, strict=True):
        if not isinstance(path, str):
            raise HTTPException(status_code=400, detail="Each image binding must be a dotted string path")
        try:
            set_dotted_path(workflow, path, uploaded_name)
        except KeyError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Image binding points to missing workflow path: {path}",
            ) from exc

    client_id = str(uuid.uuid4())
    payload = {"prompt": workflow, "client_id": client_id}
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(f"{http_url}/prompt", json=payload)

    if response.is_error:
        raise HTTPException(
            status_code=502,
            detail=f"ComfyUI /prompt failed: {response.status_code} {response.text[:1000]}",
        )

    result = response.json()
    if result.get("error") or result.get("node_errors"):
        raise HTTPException(status_code=400, detail=result)
    if not result.get("prompt_id"):
        raise HTTPException(status_code=502, detail=f"Unexpected /prompt response: {result}")

    return {
        "prompt_id": result["prompt_id"],
        "client_id": client_id,
        "queue_number": result.get("number"),
        "uploaded_images": uploaded_names,
    }


@app.websocket("/api/ws/{client_id}")
async def websocket_proxy(
    socket: WebSocket,
    client_id: str,
    prompt_id: str | None = Query(default=None),
) -> None:
    await socket.accept()
    config = load_config()
    _, ws_url = comfy_urls(config)
    separator = "&" if "?" in ws_url else "?"
    upstream_url = f"{ws_url}{separator}clientId={urllib.parse.quote(client_id)}"

    try:
        async with websockets.connect(upstream_url, max_size=None, ping_interval=20) as upstream:
            while True:
                message = await upstream.recv()
                if isinstance(message, bytes):
                    # Binary preview frames are intentionally omitted from the minimal UI.
                    continue
                await socket.send_text(message)
                try:
                    event = json.loads(message)
                except json.JSONDecodeError:
                    continue
                data = event.get("data", {}) if isinstance(event, dict) else {}
                if (
                    prompt_id
                    and event.get("type") == "executing"
                    and data.get("prompt_id") == prompt_id
                    and data.get("node") is None
                ):
                    break
    except Exception as exc:
        await socket.send_json({"type": "proxy_error", "data": {"message": str(exc)}})
    finally:
        try:
            await socket.close()
        except Exception:
            pass


@app.get("/api/history/{prompt_id}")
async def history(prompt_id: str) -> dict[str, Any]:
    config = load_config()
    http_url, _ = comfy_urls(config)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{http_url}/history/{urllib.parse.quote(prompt_id)}")
    if response.is_error:
        raise HTTPException(
            status_code=502,
            detail=f"ComfyUI history failed: {response.status_code} {response.text[:500]}",
        )

    payload = response.json()
    entry = payload.get(prompt_id)
    if not entry:
        return {"done": False, "prompt_id": prompt_id, "assets": []}

    return {
        "done": True,
        "prompt_id": prompt_id,
        "status": entry.get("status"),
        "assets": collect_assets(entry),
    }


@app.get("/api/view")
async def view_output(
    filename: str,
    subfolder: str = "",
    type: str = Query(default="output"),
) -> Response:
    if type not in {"input", "output", "temp"}:
        raise HTTPException(status_code=400, detail="Invalid ComfyUI file type")
    if ".." in filename or ".." in subfolder:
        raise HTTPException(status_code=400, detail="Invalid output path")

    config = load_config()
    http_url, _ = comfy_urls(config)
    params = {"filename": filename, "subfolder": subfolder, "type": type}
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(f"{http_url}/view", params=params)
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"ComfyUI /view failed: {response.status_code}")

    media_type = response.headers.get("content-type")
    if not media_type:
        media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(content=response.content, media_type=media_type)
