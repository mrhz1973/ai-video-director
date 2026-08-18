# AI Video Director

Public, text-only production memory and prompt-control plane for a cinematic AI-video project. The repository records intent, continuity, prompts, Character Element metadata, reference hashes, generation lineage, evaluations, handoffs and provider-specific directing skills. Personal images, video, audio and edit files are never stored here.

Start with START_HERE.md. Agent-specific operating rules live in AGENTS.md.

## Current film checkpoint

SEQ01 / SH010 — clandestine radio hut

- V2A: preferred body anatomy and skin baseline.
- V3: face, framing, hut composition and eye-led turn approved; tattoo, body hair and head/body proportions rejected.
- V4: prompt complete, corrected Element available, one Higgsfield generation authorized but not launched.
- Exact active Element: @char_char_martino-completo-corpo_v3_V3

See HANDOFF.md for the live film state. The H3/ComfyUI tooling is additive and does not alter the immutable Higgsfield run history.

## Director skills

- `.agents/skills/video-director-router/` — master router across image/video providers.
- `.agents/skills/lira-image-prompts/` — still-image/reference creation and repair.
- `.agents/skills/acting-performance/` — observable acting, beats, listening and eye life.
- `.agents/skills/cinedance-higgsfield/` — Higgsfield/Seedance camera, blocking, physics and prompt structure.
- `.agents/skills/minimax-h3-director/` — MiniMax H3 T2VA, I2VA, FL2VA, L2VA and Ref2VA prompt director based on MiniMax's official prompt-writing structure.

The target model's native schema always wins. Acting and camera/blocking modules enrich the content without replacing provider-specific field names or timing rules.

## Local ComfyUI harness

`apps/comfyui-harness/` contains a minimal local launcher for API-format ComfyUI workflows:

- prompt/chat-style input;
- image attachments;
- T2V / I2V / FL2V workflow selection;
- model, quality, steps, duration, aspect and seed controls;
- ComfyUI `/upload/image`, `/prompt`, `/ws`, `/history/{prompt_id}` and `/view` integration.

The harness is workflow-agnostic: export the workflows that already work on the local ComfyUI installation and bind their actual node inputs in `config.json`. It does not guess MiniMax H3 custom-node IDs.

See `apps/comfyui-harness/README.md`.

## Repository map

- AGENTS.md — automatic operating instructions for future coding agents.
- START_HERE.md — universal onboarding and read order.
- HANDOFF.md — smallest complete live checkpoint.
- PROJECT_BRIEF.md — stable scope, workflow and generation gate.
- PROJECT_STATUS.md — current production state.
- CONTINUITY_BIBLE.md — character, performance and visual invariants.
- story/ — source master, shot placeholders and audio plan.
- shots/ — immutable per-generation run, lineage and review records.
- prompts/ — immutable prompt versions.
- registry/ — Elements, generated outputs and active shot index.
- docs/REFERENCE_ASSETS.md — external media names and SHA-256 fingerprints.
- docs/playbooks/INDEX.md — task-to-skill routing and source fingerprints.
- .agents/skills/ — project-shared acting, image and video-prompt workflows.
- apps/comfyui-harness/ — local ComfyUI execution UI/backend.
- decisions/ — architecture and production decision records.
- logs/ — dated chronological work log.
- templates/ — reusable production records.
- scripts/ — validation tools.
- .github/workflows/ — automatic repository checks.

## Public safety rule

Only text, hashes and non-secret technical metadata belong here. Never commit photographs, clips, audio, local paths, Library/upload IDs, credentials or unnecessary personal data.

## Validation

Run:

    python3 scripts/validate_project.py

