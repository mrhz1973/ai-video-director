# Workflow files

This harness does not invent a MiniMax H3 ComfyUI graph. Use the exact workflows
that work on the user's local ComfyUI installation, export each one in ComfyUI's
API JSON format, and place them here.

Expected filenames from `config.example.json`:

- `t2v_api.json`
- `i2v_api.json`
- `fl2v_api.json`

You may rename them; update `workflows.<MODE>.file` in `config.json` accordingly.

## Binding model

The harness patches values into the exported API graph using dotted JSON paths.
A path such as:

```text
3.inputs.seed
```

means:

```json
{
  "3": {
    "inputs": {
      "seed": "patched here"
    }
  }
}
```

Supported binding keys are:

- `prompt`
- `model`
- `steps`
- `duration`
- `aspect`
- `seed`
- `quality`
- `images`

`images` is an ordered array of node-input paths. For I2V, the first uploaded
image is patched into the first path. For FL2V, upload first-frame image first
and last-frame image second; they are patched in the same order.

Any binding may be omitted when that setting is fixed inside the workflow or is
not represented by a single string/number input.

## Important limitation

Different H3/ComfyUI node packs expose different node IDs and parameter names.
The values in `config.example.json` are examples only. Open the exported API
JSON and replace each dotted path with the real node/input path from the local
workflow.

If aspect ratio is represented by separate width and height fields instead of a
single aspect string, keep those dimensions fixed in separate exported workflow
presets or adapt the binding layer before use. The minimal harness deliberately
avoids guessing a node-pack-specific width/height convention.
