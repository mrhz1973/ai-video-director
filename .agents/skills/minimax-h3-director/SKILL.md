---
name: minimax-h3-director
description: Direct, write, diagnose, and validate MiniMax H3 audiovisual prompts for local ComfyUI T2VA, I2VA, FL2VA, L2VA, and Ref2VA workflows. Use for H3 prompt creation or repair, keyframe alignment, native audio, reference mapping, and H3 generation preparation; do not use H3 syntax for Higgsfield or Seedance jobs.
---

# MiniMax H3 Director

MiniMax's H3 format is authoritative. Preserve user intent, exact dialogue, and asset roles; never translate dialogue, lyrics, or visible text inside the generated English prompt.

## Route the mode

1. Choose exactly one mode from the supplied assets and intent:
   - T2VA: text only.
   - I2VA: one image is the first frame.
   - FL2VA: supplied first and last frames.
   - L2VA: one image is the last frame.
   - Ref2VA: images, video, or audio guide subjects, motion, style, editing, continuation, or sound without being limited to endpoint frames.
2. Read [references/h3-base-modes.md](references/h3-base-modes.md) for T2VA/I2VA/FL2VA/L2VA, or [references/h3-ref2va.md](references/h3-ref2va.md) for Ref2VA. Do not load both unless the request genuinely mixes reference roles.
3. If preparing a local run, also read [references/comfyui-local.md](references/comfyui-local.md).

## Optional compatible modules

- Acting: read `../acting-performance/SKILL.md` when people perform, react, listen, speak, or require eye-life. Import only observable behavior, breathing, business, gaze, and timed beats.
- CineDance: read `../cinedance-higgsfield/SKILL.md` only when blocking, camera, physical contact, lighting, or motion physics need detailed control. Translate useful decisions into H3 natural-English shot syntax; never copy Higgsfield section headers, @tag semantics, generation settings, or provider-specific locks.
- Lira: read `../lira-image-prompts/SKILL.md` only when an input image, identity plate, reference sheet, or endpoint frame must first be designed or repaired. Keep image-generation prompt syntax out of the H3 video prompt.

H3 mode, field order, labels, dialogue markup, audio categories, cut timestamps, and keyframe alignment always override imported module conventions.

## Build and validate

1. Establish duration, aspect, target mode, active assets, each asset's role, and whether sound/music is wanted. Do not invent an asset role.
2. Write one chronological audiovisual timeline. Prefer one continuous shot for FL2VA unless cuts are requested.
3. Use concrete visible and audible events. Describe camera motion naturally with type, meaningful amplitude, and speed.
4. Give only actual vocal sources stable `(S1)`, `(S2)` IDs. Put exact spoken content in `<d>[Language] ...</d>`.
5. Use `overall_soundscape: N/A` only for explicitly complete silence. Use `non_diegetic_music: N/A` when there is no audience-only score.
6. Check duration, strictly increasing cut timestamps, label consistency, endpoint convergence, speaker continuity, and that dialogue appears only once.
7. For every reference, verify both its positive authority and its exclusion boundary: what it controls and what must not be inherited from it.
8. When references conflict, state an explicit precedence by attribute (for example, pictures control identity and environment while a video controls motion and cut rhythm). Never leave the model to resolve the conflict implicitly.
9. Return the production prompt first. Add settings or notes only when requested or needed to prevent a configuration mismatch.

## Authority and provenance

The condensed references in this skill derive from MiniMax-AI/MiniMax-H3 commit `d21241f0a4b3acbb34c97dae47fa417b7065e438` as retrieved on 2026-08-18. When the repository's official guide changes, update the provenance record and re-check exact templates before changing this skill.
