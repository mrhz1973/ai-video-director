# Agent operating instructions

This repository is the public, text-only control plane for the Rambo AI Film project. Treat it as project memory, not as media storage.

## Mandatory startup order

Before proposing or changing anything:

1. Read START_HERE.md.
2. Read PROJECT_BRIEF.md, PROJECT_STATUS.md and HANDOFF.md.
3. Read CONTINUITY_BIBLE.md.
4. Read shots/SEQ01/SH010/README.md and the latest run, review and lineage files.
5. Read the active prompt named in registry/shots.csv.
6. Read registry/elements.yaml, registry/generations.csv and docs/REFERENCE_ASSETS.md.
7. Load the relevant project skill listed below.

Then give a short checkpoint: objective, approved facts, rejected facts, active Element, next action and unresolved unknowns. Do not make a new user repeat documented context.

## Project skills

- Image reference creation or repair: read .agents/skills/lira-image-prompts/SKILL.md.
- Character performance, acting beats or eye behavior: read .agents/skills/acting-performance/SKILL.md.
- Higgsfield or Seedance video prompts, camera, blocking, physics, continuity or review: read .agents/skills/cinedance-higgsfield/SKILL.md.
- MiniMax H3 prompts or local H3 ComfyUI preparation: read .agents/skills/minimax-h3-director/SKILL.md.
- Mixed provider/reference/performance tasks: read .agents/skills/video-ai-director/SKILL.md and follow its routing table.
- For a final video prompt or review, use both cinedance-higgsfield and acting-performance.
- Read each selected SKILL.md completely and follow any referenced project manual it requires.

## Sources of truth

- Current operational state: HANDOFF.md and PROJECT_STATUS.md.
- Character continuity: CONTINUITY_BIBLE.md.
- Active handles: registry/elements.yaml. Never guess or normalize a handle.
- Shot state and active prompt: registry/shots.csv.
- Actual generated outputs: registry/generations.csv plus the immutable run folder.
- Media identity: filename plus SHA-256 in docs/REFERENCE_ASSETS.md or a run manifest.
- Historical evidence: immutable prompt, run, review and lineage files. Never rewrite history to make a failed attempt look successful.

When records conflict, stop and report the conflict before generating or changing provider state.

## Versioning rules

- Never overwrite an executed prompt. Add a new prompt version.
- Never reuse a generation key. Use the next G-number.
- Every generation gets a run.yaml, lineage.yaml and review.md.
- Record model, UI settings, Element handle, reference keys, prompt path, output filename, SHA-256 and verdict.
- Unknown provider IDs remain null. Do not invent them.
- After every provider generation, update the run, review, registries, PROJECT_STATUS.md, HANDOFF.md, the dated log and CHANGELOG.md.

## Public repository policy

This repository is public. Commit only text, hashes and non-secret technical metadata.

Never commit or paste:
- photographs, clips, audio, edit projects or generated image bytes;
- local filesystem paths;
- ChatGPT Library IDs or upload IDs;
- tokens, cookies, API keys, passwords or account exports;
- unnecessary personal data.

Media stays external and is identified here only by a neutral filename and SHA-256. Run scripts/validate_project.py before publishing.

## Generation and external-action gate

Preparing prompts, reviews and repository files is allowed. A paid Higgsfield generation requires the user's exact written phrase:

AUTORIZZO LA GENERAZIONE

Record that authorization in the planned run manifest before launching. Authorization covers only the documented run. Do not operate a cloud browser, Higgsfield account or other external service unless the user explicitly asks for that action.

## Quality rules

- Preserve the approved V3 face, framing, hut composition and eye-led final turn.
- V3 is not a body or tattoo master.
- Use the exact active Element string from the registry.
- Describe visible behavior, camera-readable physics and timed beats.
- Do not add descriptive labels that invite tattoo reinterpretation.
- Do not solve anatomy by changing the approved composition.

