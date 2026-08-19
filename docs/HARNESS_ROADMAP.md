# AI Video Director — H3 harness and prompt roadmap

Updated: 2026-08-20
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
- quality/resolution preset;
- duration;
- aspect ratio;
- steps;
- seed;
- Generate and progress/output state.

Do not turn the basic view into a node editor.

## 2. Add an expandable Advanced mode

Future harness work should expose more of the useful controls already present in the active ComfyUI workflows while keeping them behind a clearly separated Advanced panel.

Candidate controls include, only when they exist as real validated workflow inputs:

- sampler;
- scheduler;
- guidance / CFG or equivalent guidance controls;
- megapixels and/or explicit resolution controls;
- denoise/strength where applicable;
- model-specific shift or sampling parameters;
- audio/video conditioning controls;
- additional reference-conditioning parameters;
- output/save options that materially affect generation.

The harness must discover or explicitly bind real node inputs. Do not invent generic controls that are not connected to the selected workflow.

Basic and Advanced views must use the same underlying validated workflow contract so switching UI mode cannot silently change generation behavior.

## 3. Improve prompt quality systematically

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

## 4. Test stronger / higher-quality models without losing the stable baseline

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

## 5. Build an experiment / comparison workflow

A future improvement should make A/B testing easier without requiring raw ComfyUI operation.

Useful experiment dimensions may include:

- prompt A vs prompt B;
- same prompt with different seed;
- Stable vs Candidate model;
- Preview vs Final;
- sampler/scheduler variations;
- reference-card strategy vs single first-frame strategy;
- I2VA vs Ref2VA for the same creative target.

Each comparison should change as few variables as possible. Record the variables changed and the verdict so later chats do not repeat failed experiments.

## 6. Improve project persistence

The current private project layer is read/reuse only. A future harness version should add a safe Save Project / Update Project flow for local `.local.json` files.

It should preserve:

- workflow;
- prompt;
- user-visible settings;
- reference-role filenames held in ComfyUI input;
- optional experiment notes.

Because project files can contain private local reference filenames, they remain Git-ignored. The public repository should record only the schema/behavior and sanitized examples.

## 7. Better workflow and model registry

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

## 8. Preserve current architecture unless intentionally changed

The following remain current design decisions until a later approved change says otherwise:

- ComfyUI lifecycle is external to the harness;
- WebSocket/SSE is primary progress transport with read-only history polling fallback;
- manual prompts pass essentially unchanged to ComfyUI;
- T2VA/I2VA/FL2VA use the current Base-family workflow/checkpoint strategy;
- Ref2VA remains a separate task-specific workflow/checkpoint family;
- private workflow exports and private project files stay outside Git;
- the harness should remain easier to operate than raw ComfyUI.

## 9. Change-management rule for future chats and Cursor work

Before implementation:

1. read `START_HERE.md`, `HANDOFF.md`, `docs/HARNESS_STATE.md`, this roadmap and `docs/COMFYUI_H3_SETUP.md`;
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

Recommended order after the current video experiment:

1. design the Basic + Advanced harness UI from the real existing ComfyUI inputs;
2. implement Save/Update Project locally;
3. improve prompt versioning and experiment records;
4. expose validated advanced generation controls;
5. evaluate stronger compatible H3 model variants against the stable baseline;
6. consider an optional Director prompt-create/validate action only after manual prompt workflows remain fully preserved.
