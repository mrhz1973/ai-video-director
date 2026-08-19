# Local ComfyUI execution contract

The harness consumes workflow JSON exported with ComfyUI's **Save (API Format)** option. It never tries to infer custom-node IDs.

1. Pick the preset matching T2VA, I2VA, or FL2VA. L2VA may reuse an endpoint-capable graph with only the last-frame binding if the installed nodes support it. Ref2VA requires its own graph and bindings.
2. Upload referenced files through `POST /upload/image`; put the returned `name` into the configured LoadImage node input.
3. Clone the selected workflow JSON and apply only declared bindings for prompt, model, steps, duration/frames, width, height, seed, and image inputs.
4. Queue `{prompt: workflow, client_id: clientId}` with `POST /prompt` and retain `prompt_id`.
5. Monitor `ws://HOST/ws?clientId=...`. Filter all events by `prompt_id`; completion is `executing` with `node: null`. Treat `execution_error` and `execution_interrupted` as terminal failures.
6. If WebSocket delivery stalls, poll `GET /history/{prompt_id}` as a recovery path.
7. Collect images, animated images, and video descriptors from `history[prompt_id].outputs`; construct `/view` URLs from `filename`, `subfolder`, and `type`.

Keep ComfyUI bound to localhost unless the user deliberately configures authentication and network exposure. Never commit workflow exports containing local paths, credentials, private media, or provider tokens.
