/** Safe HTTP response helpers for the harness server. */

export function canWriteResponse(res) {
  if (!res) return false;
  if (res.destroyed) return false;
  if (res.writableEnded) return false;
  if (res.headersSent) return false;
  return true;
}

/**
 * Send a JSON response only when the socket can still accept a new response.
 * @returns {boolean} true if a response was written
 */
export function sendJson(res, status, body) {
  if (!canWriteResponse(res)) return false;
  try {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
    return true;
  } catch {
    return false;
  }
}

/** End an already-started response without attempting a second writeHead. */
export function endStartedResponse(res) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    res.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Buffer an upstream Response body, then write downstream headers+body.
 * Never writes headers before the await that can throw.
 */
export async function sendBufferedUpstream(res, upstream, { fallbackType = "application/octet-stream" } = {}) {
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (!canWriteResponse(res)) return false;
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || fallbackType
  });
  res.end(buffer);
  return true;
}

export function attachSafeStaticStream(res, stream, logger, pathHint) {
  stream.on("error", error => {
    logger?.error?.("static_stream_error", { path: pathHint, reason: error.message });
    if (canWriteResponse(res)) {
      sendJson(res, 500, { error: "Static file read failed" });
      return;
    }
    endStartedResponse(res);
  });
  stream.pipe(res);
}
