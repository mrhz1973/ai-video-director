# Workflow presets

Export each graph from ComfyUI using **Save (API Format)** and save the JSON in this directory. Then add a sibling `.preset.json` file.

Example `t2va.preset.json`:

```json
{
  "id": "t2va",
  "label": "H3 T2VA",
  "mode": "T2VA",
  "workflow": "t2va.api.json",
  "bindings": {
    "prompt": { "node": "12", "input": "text" },
    "model": { "node": "4", "input": "model_name" },
    "steps": { "node": "8", "input": "steps" },
    "seed": { "node": "8", "input": "seed" },
    "width": { "node": "6", "input": "width" },
    "height": { "node": "6", "input": "height" },
    "duration": { "node": "7", "input": "duration" }
  },
  "options": {
    "models": ["MiniMax-H3 Base FL2VA"],
    "qualities": ["Preview", "Final"]
  }
}
```

For I2VA add `"firstImage"`; for FL2VA add both `"firstImage"` and `"lastImage"`. Each image binding points to the LoadImage input that expects the uploaded filename. Bindings are validated before a job is queued; unknown nodes or inputs produce an error instead of silently changing the wrong node.

Do not commit real workflow exports until local paths and private metadata have been removed.
