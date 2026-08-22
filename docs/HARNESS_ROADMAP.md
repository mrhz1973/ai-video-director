# AI Video Director — H3 harness and prompt roadmap

Updated: 2026-08-22
Status: planned direction; not all items are implemented
Canonical branch: `main`

This document records the approved future direction for the local MiniMax H3 / ComfyUI system so later chats do not lose design intent. Read it together with `docs/HARNESS_STATE.md` before planning runtime changes.

## Core rule: GitHub is the durable project memory

Every approved change that materially affects how the system works or how videos are produced must leave a public, text-only trace in this repository.

Record, as applicable:

- harness/runtime behavior changes;
- UI controls and their real workflow bindings;
- prompt-writing rules and tested prompt patterns;
- model/checkpoint choices and why they were selected;
- sampler/scheduler or other generation-setting experiments;
- workflow topology/version changes;
- validation/test results;
- known regressions, rejected experiments and rollback decisions;
- user-facing operating procedures.

Do not rely on chat history as the only source of truth.

The repository is public, so durable memory must still respect repository hygiene. Never commit media, model binaries, secrets, private absolute paths, private `*.api.json` exports, private `*.local.json` projects, or personal reference filenames. Record safe metadata, hashes, sanitized workflow files, decisions and reproducible settings instead.

## 1. Keep the harness simple by default

The daily UI should stay faster and clearer than raw ComfyUI.

Default/basic view should continue to expose the high-value controls needed for routine generations, such as:

- workflow/mode;
- prompt;
- project/reference roles;
- model;
- direct megapixel control;
- duration;
- aspect ratio;
- steps;
- seed;
- Generate and progress/output state, including the Issue #7 graphical current-node progress monitor and expandable ComfyUI event/terminal panels.

Do not turn the basic view into a node editor.

### Direct megapixel control and standard-resolution hint

Status: implemented in harness v0.4.1. `docs/HARNESS_STATE.md` records the verified runtime behavior, the real ComfyUI constraints and the exact rounding method. The rest of this section is the original design intent.

The old user-facing `Preview / Final` abstraction has been replaced by the exact numeric megapixel value that is bound to the ComfyUI workflow.

Next to the megapixel input, show a read-only dynamic resolution hint derived from both:

- the explicit megapixel value;
- the currently selected aspect ratio.

The hint should show:

1. the approximate effective pixel dimensions, rounded only for display to sensible model/grid-friendly values;
2. the nearest familiar resolution class where one is meaningful.

Example presentation:

`Megapixel  [ 0.4 ]   ≈ 864×480 · ~480p`

The shipped hint uses the real `ResolutionSelector` arithmetic (1024² pixels per megapixel, rounded to the workflow's `multiple` of 32), so at 0.4 MP / 16:9 the exact dimensions are 864×480 rather than the 848×480 approximation originally sketched here.

For common 16:9 values, useful human-readable labels include approximately:

- 480p;
- 720p HD;
- 1080p Full HD;
- 1440p QHD;
- 2160p / 4K UHD.

Do not mislabel standards. In particular, do not call 2560×1440 exact `2K`; if a 2K label is ever used, distinguish true DCI 2K (2048×1080) from QHD/1440p. Prefer unambiguous labels such as `1440p QHD` and `4K UHD`.

For non-16:9 aspect ratios, the exact WxH estimate is primary. A secondary familiar label may be shown only when it remains meaningful, for example `~1080p ultrawide`, but the UI must not imply that a standard broadcast/video raster exactly matches an arbitrary aspect ratio.

This resolution hint is informational only. It must never silently alter the megapixel value, aspect ratio, or workflow. The exact numeric megapixel field remains the generation source of truth.

## 2. Add an expandable Advanced mode

Future harness work should expose more of the useful controls already present in the active ComfyUI workflows while keeping them behind a clearly separated Advanced panel.

Candidate controls include, only when they exist as real validated workflow inputs:

- sampler;
- scheduler;
- guidance / CFG or equivalent guidance controls;
- the `ResolutionSelector` `multiple` widget, which is currently fixed at 32 in the workflows and only read by the display hint;
- denoise/strength where applicable;
- model-specific shift or sampling parameters;
- audio/video conditioning controls;
- additional reference-conditioning parameters;
- output/save options that materially affect generation.

The harness must discover or explicitly bind real node inputs. Do not invent generic controls that are not connected to the selected workflow.

Basic and Advanced views must use the same underlying validated workflow contract so switching UI mode cannot silently change generation behavior.

## 3. Show the effective submitted/running ComfyUI workflow

The harness should make it possible to inspect what was actually submitted to ComfyUI and what job is currently running, rather than relying on browser form fields that may be stale or belong to another tab.

For every submitted/running job, expose a read-only view containing at minimum:

- prompt/job ID;
- workflow/mode;
- model;
- sampler and scheduler when present;
- steps;
- seed;
- duration;
- aspect/resolution conditioning;
- effective reference-loader bindings;
- output node(s);
- queue state and progress;
- the exact API-format prompt graph actually sent to ComfyUI.

When ComfyUI provides `/api/jobs/{job_id}` or equivalent queue/history data, use that live job data as the source of truth for execution inspection.

The harness should also support a clear distinction between:

1. **Effective runtime graph** — the exact API-format graph submitted to ComfyUI and used by the job. This is authoritative for execution.
2. **Visual authoring workflow** — the corresponding UI-format ComfyUI workflow with node positions/widgets, when a compatible visual workflow file is available.

Do not imply that API-format prompt JSON can always be reconstructed losslessly into the visual ComfyUI canvas; UI layout/authoring metadata may not be present in the runtime graph. Where a matching visual workflow is maintained, provide an explicit `Open/View in ComfyUI` path rather than guessing the canvas layout.

This workflow-inspection feature should be read-only by default. Viewing the running graph must never mutate, cancel, reorder or resubmit the job.

## 4. Improve prompt quality systematically

Prompt improvement is a first-class project goal, not an incidental chat task.

Future prompt work should:

- follow the native MiniMax H3 schema for the selected mode;
- use observable acting and eye behavior rather than vague emotion labels;
- specify clear shot continuity, camera behavior and physical actions;
- control timing only where it helps the model and avoid contradictory instructions;
- define authority and exclusion boundaries when multiple references are used;
- explicitly design soundscape/music when H3 native audio is wanted;
- keep visible text requirements precise and test them separately because text stability is difficult;
- preserve a clean manual-prompt passthrough path even if an optional Director prompt generator is added later.

Important prompt experiments should be versioned or summarized in the repository with:

- mode;
- prompt version or strategy;
- key reference roles;
- seed/settings when useful;
- observed result;
- what improved or regressed;
- next hypothesis.

Do not overwrite successful historical prompt evidence merely because a newer prompt exists.

## 5. Test stronger / higher-quality models without losing the stable baseline

The user wants to evaluate more capable or less aggressively quantized models/checkpoints when hardware and installed ComfyUI support make that practical.

Model experimentation must be controlled:

1. preserve the current known-working model as the stable baseline;
2. add candidate models as explicit alternatives rather than silently replacing the baseline;
3. verify the candidate is compatible with the exact H3 task/workflow before exposing it in the harness;
4. record safe metadata such as checkpoint filename, task family, quantization/precision when known, source/version if known, and the workflow in which it was tested;
5. compare output quality, generation time, memory pressure/stability and obvious regressions;
6. promote a candidate to default only after a documented comparison.

A model name alone is not evidence that it is better. Decisions should be based on controlled local tests.

Where useful, maintain model states such as:

- Stable
- Candidate
- Experimental
- Rejected / incompatible

Do not commit model binaries to GitHub.

## 6. Build an experiment / comparison workflow

A future improvement should make A/B testing easier without requiring raw ComfyUI operation.

Useful experiment dimensions may include:

- prompt A vs prompt B;
- same prompt with different seed;
- Stable vs Candidate model;
- megapixel/resolution variations;
- sampler/scheduler variations;
- reference-card strategy vs single first-frame strategy;
- I2VA vs Ref2VA for the same creative target.

Each comparison should change as few variables as possible. Record the variables changed and the verdict so later chats do not repeat failed experiments.

## 7. Improve project persistence

Status: implemented in harness v0.5.0 (Issue #5). See `docs/HARNESS_STATE.md`.

The private project layer now supports Save / Update / Save As / Duplicate / Delete with dirty-state tracking, plus a categorized multi-file asset library (Elements, Locations, Objects, Audio). Library groups are distinct from workflow role bindings. Project files remain Git-ignored; the public repository records only schema/behavior and sanitized examples.

## 8. Better workflow and model registry

A future registry layer should make the harness aware of what each preset actually supports.

Desired metadata includes:

- workflow id and mode;
- sanitized workflow/version/hash;
- required custom nodes or node-version expectations where available;
- validated UI bindings;
- supported model options;
- which controls belong in Basic vs Advanced mode;
- model/task compatibility;
- last validation result.

This should reduce accidental stale node IDs and make future workflow upgrades auditable.

## 9. Preserve current architecture unless intentionally changed

The following remain current design decisions until a later approved change says otherwise:

- ComfyUI lifecycle is external to the harness;
- WebSocket/SSE is primary progress transport with read-only history polling fallback;
- manual prompts pass essentially unchanged to ComfyUI;
- T2VA/I2VA/FL2VA use the current Base-family workflow/checkpoint strategy;
- Ref2VA remains a separate task-specific workflow/checkpoint family;
- private workflow exports and private project files stay outside Git;
- the harness should remain easier to operate than raw ComfyUI.

## 10. Change-management rule for future chats and Cursor work

Before implementation:

1. read `START_HERE.md`, `HANDOFF.md`, `docs/HARNESS_STATE.md`, `docs/HARNESS_OPERATING_RULES.md`, this roadmap and `docs/COMFYUI_H3_SETUP.md`;
2. inspect the actual active workflow/preset and live ComfyUI capabilities rather than guessing;
3. state whether the task is PLAN or AGENT work;
4. preserve a known-good baseline and avoid changing multiple generation variables at once when testing quality.

After an approved implementation or meaningful experiment:

1. update the relevant durable documentation;
2. update `CHANGELOG.md` for material changes;
3. add/update tests when runtime code changes;
4. validate the repository;
5. use a task-specific branch/PR for runtime changes unless the change is documentation-only and intentionally written directly to `main`;
6. merge only after validation;
7. ensure `main` again describes the real operational state.

A change is not considered fully integrated if the implementation exists only on the local machine or only in a chat transcript.

## Near-term order

v0.8.2 shipped queued-next + deferred Batch handoff, prompt clear/history, integer duration, completion/output access, unified Save, asset group headers, and bottom prompt resizing (Issues #27–#31). Those items are no longer future work.

Recommended order after the current video experiment:

1. ~~Issue #11 PR B — I2VA/FL2VA aspect-ratio-safe center-crop~~ — implemented in harness **v0.6.0** (fail-closed inspector + public `scripts/apply_h3_safe_fit.mjs`; private graphs patched separately). Optional future Pad/Stretch modes remain deferred;
2. activate v0.6.0 on live after PR merge + controlled private-workflow `--apply` + visual approval (Issue #11 stays open until that activation completes);
3. design the Basic + Advanced harness UI from the real existing ComfyUI inputs;
4. add effective submitted/running workflow inspection and, where possible, a matching visual `Open/View in ComfyUI` path;
5. improve prompt versioning and experiment records;
6. expose validated advanced generation controls;
7. evaluate stronger compatible H3 model variants against the stable baseline;
8. consider an optional Director prompt-create/validate action only after manual prompt workflows remain fully preserved.
