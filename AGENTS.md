# Agent operating instructions

This repository is the public, text-only control plane for AI Video Director. It stores project memory, production decisions and harness architecture, not media. The Rambo AI Film sequence remains one active production track inside this repository.

## Mandatory startup order

Before proposing or changing anything:

1. Read START_HERE.md.
2. Read PROJECT_BRIEF.md, PROJECT_STATUS.md and HANDOFF.md.
3. Read docs/HARNESS_STATE.md and docs/COMFYUI_H3_SETUP.md for MiniMax H3/local harness context.
4. Read CONTINUITY_BIBLE.md.
5. Read shots/SEQ01/SH010/README.md and the latest run, review and lineage files when the task concerns that shot.
6. Read the active prompt named in registry/shots.csv when the task concerns an active shot.
7. Read registry/elements.yaml, registry/generations.csv and docs/REFERENCE_ASSETS.md when identity/generation history matters.
8. Load the relevant project skill listed below.

Then give a short checkpoint appropriate to the task. Do not make a new user repeat documented context.

For Rambo/Higgsfield work, include objective, approved facts, rejected facts, active Element, next action and unresolved unknowns.

For MiniMax H3 harness work, include current harness branch/version, what is already implemented, deliberate non-features, relevant workflow source-of-truth files, restart impact and unresolved unknowns.

## Project skills

- Image reference creation or repair: read .agents/skills/lira-image-prompts/SKILL.md.
- Character performance, acting beats or eye behavior: read .agents/skills/acting-performance/SKILL.md.
- Higgsfield or Seedance video prompts, camera, blocking, physics, continuity or review: read .agents/skills/cinedance-higgsfield/SKILL.md.
- MiniMax H3 prompts or local H3 ComfyUI preparation: read .agents/skills/minimax-h3-director/SKILL.md.
- Mixed provider/reference/performance tasks: read .agents/skills/video-ai-director/SKILL.md and follow its routing table.
- For a final Higgsfield/Seedance video prompt or review, use both cinedance-higgsfield and acting-performance.
- Read each selected SKILL.md completely and follow any referenced project manual it requires.

## Sources of truth

- Current production state: HANDOFF.md and PROJECT_STATUS.md.
- Current MiniMax H3 harness architecture/state: docs/HARNESS_STATE.md.
- Harness setup/operations: docs/COMFYUI_H3_SETUP.md.
- Character continuity: CONTINUITY_BIBLE.md.
- Active handles: registry/elements.yaml. Never guess or normalize a handle.
- Shot state and active prompt: registry/shots.csv.
- Actual generated outputs: registry/generations.csv plus the immutable run folder.
- Media identity: filename plus SHA-256 in docs/REFERENCE_ASSETS.md or a run manifest.
- Historical evidence: immutable prompt, run, review and lineage files. Never rewrite history to make a failed attempt look successful.

For H3 workflow runtime, follow the source-of-truth distinctions in docs/HARNESS_STATE.md: private ignored API-format workflow exports contain the operational graph topology for Base modes, tracked presets define the UI-to-node contract, and the tracked sanitized Ref2VA workflow is the runtime file selected by its preset.

When records conflict, stop and report the conflict before generating or changing provider/runtime state.

## MiniMax H3 harness rules

- The existing operational harness is the Node.js application in `comfyui-harness/`. Do not create a second parallel harness.
- The harness does not currently start or stop ComfyUI. ComfyUI process lifecycle is external unless the user explicitly approves a future service-manager feature.
- The harness passes the manual prompt essentially unchanged to ComfyUI. The MiniMax H3 Director skill is an AI-side authoring/review layer, not a runtime LLM inside the harness.
- Do not silently rewrite prompts in runtime code.
- Do not "fix" Base FL2VA being shared by T2VA/I2VA/FL2VA, the separate Ref2VA checkpoint, Preview/Final megapixel behavior, or dormant width/height support without controlled evidence and user approval.
- Do not commit private local `*.api.json`, `*.local.json`, config overrides, local paths, uploaded reference filenames or media.
- Before changing harness runtime code, identify whether a Node restart is required and avoid restarting a live generation without explicit user approval.
- The accidental parallel branch `agent/minimax-h3-director-comfyui-harness` was abandoned on 2026-08-19; its PR #2 was closed without merge and the branch was deleted. Do not recreate it.

## Versioning rules

- Never overwrite an executed prompt. Add a new prompt version.
- Never reuse a generation key. Use the next G-number.
- Every tracked production generation gets a run.yaml, lineage.yaml and review.md.
- Record model, UI settings, Element handle, reference keys, prompt path, output filename, SHA-256 and verdict where the production registry requires them.
- Unknown provider IDs remain null. Do not invent them.
- After every provider generation, update the relevant run/review/registry state, PROJECT_STATUS.md, HANDOFF.md, dated log and CHANGELOG.md as applicable.

## Public repository policy

This repository is public. Commit only text, hashes and non-secret technical metadata.

Never commit or paste:
- photographs, clips, audio, edit projects or generated image bytes;
- local filesystem paths;
- private ComfyUI API workflow exports or local project files;
- ChatGPT Library IDs or upload IDs;
- tokens, cookies, API keys, passwords or account exports;
- unnecessary personal data.

Media stays external and is identified here only by a neutral filename and SHA-256 when a tracked production record requires it. Run scripts/validate_project.py before publishing.

## Generation and external-action gate

Preparing prompts, reviews and repository files is allowed. A paid Higgsfield generation requires the user's exact written phrase:

AUTORIZZO LA GENERAZIONE

Record that authorization in the planned run manifest before launching. Authorization covers only the documented run. Do not operate a cloud browser, Higgsfield account or other external service unless the user explicitly asks for that action.

Local ComfyUI generation/runtime changes are separate from the Higgsfield authorization gate, but never interrupt or restart a live local job unless the user explicitly approves that operational action.

## Quality rules

For the active Rambo shot:

- Preserve the approved V3 face, framing, hut composition and eye-led final turn.
- V3 is not a body or tattoo master.
- Use the exact active Element string from the registry.
- Describe visible behavior, camera-readable physics and timed beats.
- Do not add descriptive labels that invite tattoo reinterpretation.
- Do not solve anatomy by changing the approved composition.

For MiniMax H3 prompt work:

- Follow the MiniMax H3 Director skill and its provider-native schema.
- Keep Acting contributions observable and camera-readable.
- Use reference/card preparation only when it materially improves identity/continuity.
- Do not import Higgsfield/Seedance-only wrappers into H3 prompt syntax.
