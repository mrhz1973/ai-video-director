---
name: minimax-h3-director
description: >
  Write, diagnose and repair production-ready MiniMax H3 video prompts for
  T2VA, I2VA, FL2VA, L2VA and full-reference Ref2VA. Use whenever MiniMax H3
  is the target model, including prompt conversion from scene prose, first/
  last-frame work, multimodal reference tasks, audio-aware prompts and H3 QA.
---

# MiniMax H3 Director

MiniMax H3 format is authoritative whenever H3 is the target model. Camera,
acting and reference ideas may be borrowed from the project skills, but the
final H3 prompt must obey the official H3 field names, section order, timing
notation and reference semantics.

## Mandatory source order

1. Read `references/H3_OFFICIAL_NOTES.md`.
2. Read the active shot, project continuity and latest accepted/rejected review.
3. If characters perform, read `../acting-performance/SKILL.md` and apply the
   performance logic as observable behaviour inside the H3 timeline.
4. If spatial blocking, optics, physics or first-frame control are difficult,
   use `../cinedance-higgsfield/SKILL.md` only as a diagnostic vocabulary source.
   Do not copy Seedance-specific output architecture into H3.
5. If a reference image/keyframe must first be created or repaired, route that
   separate image task to `../lira-image-prompts/SKILL.md`; Lira does not own the
   final H3 video-prompt schema.

## Mode router

Choose exactly one H3 mode from the actual inputs:

- **T2VA** — text only; build the complete audiovisual timeline from prose.
- **I2VA** — one image is the literal first frame at 0.00 seconds and the video
  develops forward from it.
- **FL2VA** — first and last images are fixed anchors; describe the continuous
  path connecting them and land on the final image at the requested duration.
- **L2VA** — one image is the literal final frame; infer a plausible opening
  state and converge to the supplied last frame.
- **Ref2VA** — full-reference generation/editing using reusable subjects,
  pictures, videos and/or audio references.

Do not infer `video editing`, `video continuation`, `audio reuse` or `audio
reference` merely because a file exists. Assign the relationship according to
how the asset is actually used.

## Base-mode final architecture

For T2VA/I2VA/FL2VA/L2VA, the final body uses these three fields in this exact
order:

```text
integrated_multimodal_description: ...
overall_soundscape: ...
non_diegetic_music: ...
```

T2VA begins directly with those fields.

I2VA must begin with the exact alignment instruction documented in
`H3_OFFICIAL_NOTES.md`, then one blank line, then the three fields.

FL2VA and L2VA must begin with their documented alignment instruction, using
the actual final shot number and exact effective duration to two decimal places.

## Ref2VA final architecture

Full-reference mode uses these six sections in this exact order:

```text
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

Use stable labels consistently across all six sections:

- `<Subject N>` = reusable visible content or attributes.
- `<Picture N>` = concrete frame/keyframe/storyboard anchor when the image
  itself matters as a frame.
- `<Video N>` = source-video structure, edit source or continuation source.
- `<Audio N>` = copied or referenced audio signal.

Never renumber a reference label halfway through the prompt.

## Shot and timing rules

- Write the structural prompt in English; preserve dialogue, lyrics and visible
  scene text in their original language.
- `[Shot 1]` has no timestamp.
- A later cut begins `[Shot N] At MM:SS.mmm, ...`.
- Cut only for a real view/state/space/time change or when the user explicitly
  requests multi-shot editing.
- For I2VA, preserve first-frame identity, clothing, objects, composition and
  spatial anchors before developing motion.
- For FL2VA, prefer one continuous shot unless cuts are explicitly required;
  describe the observable transformation rather than repeating two static image
  descriptions.
- For L2VA, progressively converge toward the supplied final frame.
- Keep all actions physically achievable within the requested duration.

## Acting integration

Acting is behaviour under pressure, not emotional adjectives. When a character
is present, weave only observable markers into the H3 timeline: gaze target,
blink quality, breath, posture, contact, weight, interrupted business, tactic
change, assessment pause and state inertia.

Keep eye life active. When appropriate, thought reaches the eyes before the
head or spoken answer. Do not paste the Acting skill's headings or master
profile verbatim into the H3 final schema.

## Camera, blocking and physics integration

Use CineDance-derived ideas only where they increase H3 clarity:

- establish first-frame occupancy when important;
- define foreground/midground/background and measurable subject relationships;
- separate torso direction, head direction and gaze target;
- describe camera movement as natural English and observable image outcome;
- enforce gravity, mass, inertia, friction, contact, cloth/hair delay and liquid
  behaviour when relevant.

Do not carry over Seedance-only section names, giant negative blocks, provider
handles that H3 cannot resolve, or optics metadata that does not visibly affect
the shot.

## Audio rules

H3 is audiovisual. Treat audio as part of the timeline when the task requires
it.

- Dialogue and singing remain inside the main timeline and use stable speaker
  IDs `(S1)`, `(S2)`, etc.
- Write verbal content as `<d>[Language] ...</d>`.
- `overall_soundscape` summarizes ambience, physical sounds and non-verbal human
  sounds across the full clip; do not repeat full dialogue there.
- `non_diegetic_music` contains only music the characters cannot hear. Write
  `N/A` when none is wanted.
- If the project intentionally generates silent picture for later local audio
  assembly, state silence explicitly in the H3 sound fields instead of adding
  invented ambience.

## Reference preservation

In Ref2VA, distinguish reference fidelity from newly authored story content.
Use the official retention markers for visible references:
`fully_preserved`, `partially_preserved`, `attribute_transfer`,
`weak_reference`.

Use the official audio markers:
`fully_copy`, `partially_copy`, `reference`, `weak_reference`.

Do not call a reference partially preserved merely because new action or plot
content is added around it.

## Prompt-density rule

Prefer complete, concrete timeline information over decorative cinema prose.
Every important sentence should control at least one of: composition, identity,
blocking, action, state change, camera, lighting, sound, dialogue, reference
role or continuity.

## Silent QA before delivery

Check all of the following before returning a prompt:

- correct H3 mode;
- exact field names and section order;
- correct first/last-frame alignment line when applicable;
- requested duration matches timestamps and final frame;
- references are defined once and reused consistently;
- speaker IDs are stable;
- dialogue language is preserved;
- all active characters/props/references actually appear or affect the target;
- first frame is not accidentally empty when a subject must already be visible;
- motion is physically plausible and performance remains observable;
- soundscape and non-diegetic music do not contradict the requested audio plan.

Unless the user asks for analysis, critique, variants or QA, deliver only the
final H3 prompt.