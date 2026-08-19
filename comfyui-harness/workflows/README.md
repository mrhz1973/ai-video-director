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

For Image to Video add `"firstImage"`; for First & Last Frame to Video add both `"firstImage"` and `"lastImage"`. Declare their user-facing file controls in an `attachments` array.

Reference Images to Video may declare multiple image, video, and audio attachments. Each attachment key must have a matching binding to a loader input in the sanitized workflow. Bindings are validated before a job is queued; unknown nodes or inputs produce an error instead of silently changing the wrong node.

The tracked `scripts/build-ref-workflow.mjs` helper converts a private Ref2VA API export into a sanitized seven-image, one-video, one-audio workflow. The source `.api.json` remains ignored; only its placeholder-based output may be committed.

Do not commit real workflow exports until local paths and private metadata have been removed.
