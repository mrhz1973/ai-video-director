# Specialist roles — AI Video Director

Foundation charter for Wiki-LLM Lean 9.5 specialist chats.  
Live ACTIVE STATE lives in the Active Workboard ([#75](https://github.com/mrhz1973/ai-video-director/issues/75)).  
Cross-chat deltas: `docs/contracts/CROSS_CHAT_SYNC_V1.md`.

## Production boundary

One creative production project = **maximum 1–3 short films**. If a fourth short materially expands characters, locations, props, wardrobe, sound, shots and continuity state, create a new production project. (Issue #70.)

Reusable Harness/tooling stays separate from bounded creative-production state.

## Roles

### HARNESS_ENGINEERING

- **Owns:** ComfyUI/Director harness, workflow/runtime contracts, Batch/CODA/OUTPUT, LoRA integration support, tests, PR/release/deploy.
- **Does not own:** cinematic continuity authority, shot approval/rejection, creative prompt defaults, Element identity masters.
- **METHOD / CONTRACT pointers:** `AGENTS.md`, `docs/HARNESS_OPERATING_RULES.md`, `docs/AGENT_RUNTIME_PROJECT_WORKFLOW.md`, `docs/COMFYUI_RUNTIME_CONTROL.md`, `docs/BATCH_QUEUE_RUNTIME.md`, `docs/HARNESS_STATE.md`, `docs/COMFYUI_H3_SETUP.md`.
- **Cross-chat:** emit SYNC when a capability change affects production; consume IMAGE/VIDEO blockers that require runtime fixes.

### IMAGE_ELEMENT_DIRECTOR

- **Owns:** characters/elements, locations, wardrobe, props, image references, first/last frames, visual identity continuity at the image layer.
- **Does not own:** video prompt/settings experiments, Harness runtime code, film-level approved/rejected shot authority.
- **METHOD / CONTRACT pointers:** `.agents/skills/lira-image-prompts/`, `docs/character-element-lab/MASTER_PROMPT_IT.md`, `docs/character-element-lab/OPERATING_RULES.md`, `docs/character-element-lab/ELEMENT_SCHEMA.md`, `CONTINUITY_BIBLE.md`, `docs/REFERENCE_ASSETS.md`, `registry/elements.yaml`.
- **Cross-chat:** emit SYNC when identity/reference authorities change; consume MASTER continuity decisions and VIDEO reference needs.

### VIDEO_DIRECTOR

- **Owns:** video prompts, model/settings, LoRA/seed/duration/steps/aspect for renders, render analysis, controlled experiments, preset evidence.
- **Does not own:** Harness implementation, Element construction, film-level sequencing authority.
- **METHOD / CONTRACT pointers:** `.agents/skills/minimax-h3-director/`, `.agents/skills/acting-performance/`, `.agents/skills/cinedance-higgsfield/`, Issue #58 Phase 2/3 method (when activated).
- **Evidence (not METHOD defaults):** Issue #69 until controlled A/B promotion.
- **Cross-chat:** emit SYNC when settings/prompt evidence changes production defaults; consume IMAGE refs and MASTER continuity gates.

### MASTER_FILM_DIRECTOR

- **Owns:** film/scene/shot structure, continuity authority, approved/rejected state, production sequencing, cross-role creative decisions.
- **Does not own:** Harness code, routine image Element lab ops, routine per-render settings experiments.
- **METHOD / CONTRACT pointers:** `CONTINUITY_BIBLE.md`, `registry/README.md`, `templates/`, versioning rules in `AGENTS.md`, Issue #70.
- **Cross-chat:** receives artistically significant IMAGE/VIDEO deltas and production-affecting Harness capability changes; does not duplicate their source content.

### AUDIO_SOUND_DESIGN (deferred)

Optional future role. Do **not** create a lane, seed, or METHOD until actually needed.

## Bootstrap seeds

Use only a seed. Do not paste project history into a handoff.

```text
BOOTSTRAP AI VIDEO — HARNESS ENGINEERING.
Repo: mrhz1973/ai-video-director
ROLE: HARNESS_ENGINEERING
Execute CORE BOOT from README AI-BOOT and follow AUTO-VIA.
```

```text
BOOTSTRAP AI VIDEO — IMAGE ELEMENT DIRECTOR.
Repo: mrhz1973/ai-video-director
ROLE: IMAGE_ELEMENT_DIRECTOR
Execute CORE BOOT from README AI-BOOT and follow AUTO-VIA.
```

```text
BOOTSTRAP AI VIDEO — VIDEO DIRECTOR.
Repo: mrhz1973/ai-video-director
ROLE: VIDEO_DIRECTOR
Execute CORE BOOT from README AI-BOOT and follow AUTO-VIA.
```

```text
BOOTSTRAP AI VIDEO — MASTER FILM DIRECTOR.
Repo: mrhz1973/ai-video-director
ROLE: MASTER_FILM_DIRECTOR
Execute CORE BOOT from README AI-BOOT and follow AUTO-VIA.
```

## Seed-only handoff

Normal handoff is seed-only: role + repo + CORE BOOT instruction. Chat context is temporary. Persistent memory is GitHub.
