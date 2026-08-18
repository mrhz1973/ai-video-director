---
name: video-director-router
description: >
  Master router for this repository's AI image/video prompt skills. Selects
  Lira, Acting Performance, CineDance Higgsfield and MiniMax H3 Director based
  on the requested provider, asset type and task, while preserving the target
  model's native prompt schema.
---

# Video Director Router

Use this skill first when the task spans providers or when the user asks for a
scene, prompt, repair, review or reference workflow without naming the internal
module to use.

## Routing table

### Still-image creation or repair
Use `../lira-image-prompts/SKILL.md` for:
- character/casting still prompts;
- location/environment still prompts;
- prop prompts;
- reference-sheet preparation;
- image edits and keyframe repair.

If the resulting still becomes an H3 first/last/reference asset, Lira ends after
the still prompt is complete; H3 Director owns the subsequent video prompt.

### Acting-only work
Use `../acting-performance/SKILL.md` when the user wants:
- performance beats;
- objectives, obstacles, tactics or subtext;
- eye behavior, listening, breath, posture or reaction repair;
- acting QA independent of a specific provider schema.

### Higgsfield / Seedance video
Use `../cinedance-higgsfield/SKILL.md` as the final video-prompt authority.
Also load Acting Performance whenever a visible character performs a dramatic
beat, speaks, listens or reacts.

### MiniMax H3 video
Use `../minimax-h3-director/SKILL.md` as the final video-prompt authority for
T2VA, I2VA, FL2VA, L2VA and Ref2VA.

Also load Acting Performance when characters perform. CineDance may be loaded
only for compatible diagnostic help with blocking, physics, camera-side,
first-frame occupancy or continuity; its Seedance-specific final architecture
must not leak into H3 output.

### ComfyUI execution/harness work
Treat ComfyUI as the local execution layer, not as a prompt-writing authority.
Choose the prompt skill from the actual model/provider first, then map the final
prompt and runtime parameters into the selected ComfyUI workflow.

## Conflict precedence

When multiple skills are active, use this precedence:

1. **Target model's native prompt schema** wins.
2. **Project continuity and active reference hierarchy** win over generic style.
3. **Acting Performance** controls observable performance behavior.
4. **CineDance diagnostic rules** control blocking/camera/physics only when
   compatible with the target model.
5. **Lira** controls still-image prompt construction and image-edit discipline.

Examples:

- H3 + Acting -> H3 sections/labels/timing, with Acting behavior woven inside.
- H3 + CineDance -> H3 sections remain; use CineDance only to improve spatial
  clarity or physics.
- Seedance + Acting -> CineDance final structure with Acting behavior embedded.
- Lira + H3 -> first create/repair the reference still, then switch to H3.

## Default decisions

- If the user explicitly names a provider/model, route to that provider skill.
- If the task is a still image, route to Lira.
- If the task is explicitly character performance only, route to Acting.
- If the task is video and the current project context names H3 as the working
  model, route to H3 Director.
- If the task is video and the current project context names Higgsfield/
  Seedance, route to CineDance.
- Do not silently convert a prompt from one provider schema to another.

## Delivery rule

Unless the user asks for analysis, critique, QA or variants, return the final
artifact only. Keep internal routing invisible in normal prompt-writing output.