# H3 full-reference mode

Source of truth: MiniMax-AI/MiniMax-H3 `skills/h3-prompt-writing/references/ref-en.txt`.

Write these six sections in exactly this order:

```text
subject_definitions:
...

summary:
...

retention_analysis:
...

detailed_description:
...

overall_soundscape:
...

non_diegetic_music:
...
```

## Labels

- `<Subject N>`: a visible person, object, animal, environment, effect, or other reusable visible content. State which asset supplies each property.
- `<Picture N>`: only a concrete first/key/last/edited frame, composition anchor, or storyboard mapping. A character-only image belongs inside its Subject definition.
- `<Video N>`: whole-video editing, continuation, camera, cut, rhythm, or temporal-structure relationship. Visible content from it still needs Subject labels.
- `<Audio N>`: copied or referenced audio signal, timbre, delivery, music, beat, dialogue, lyrics, effects, or continuity. Audio and Video numbering are independent.

Never introduce a new label after `subject_definitions`.

## Reference authority boundaries

- Map each upload-order slot to its H3 label from the active workflow or interface. Do not infer numbering from a filename, library name, UUID, or prose order.
- Give every reference one bounded authority and state what it must not contribute when confusion is plausible. Example: a video may define body mechanics, camera movement, and cut rhythm while explicitly not contributing identity, wardrobe, props, or location.
- Split authority by attribute instead of saying only “use the references.” Name which asset controls face, body, wardrobe, prop appearance, environment, motion, performance, camera, edit rhythm, voice, music, or sound.
- When references disagree, declare the precedence inside `subject_definitions` and reinforce it in `retention_analysis`. The model must not choose between conflicting identity, wardrobe, environment, or timeline evidence implicitly.
- If a source video is the sole editing master, use the `video editing` relationship and state exactly what the edit changes and what remains preserved. If it supplies only motion or camera behavior, use `attribute_transfer` and exclude its visible subjects and setting.
- Keep official H3 labels and the six-section Ref2VA order. Do not substitute generic tokens such as `Image1` or unofficial bracketed section headings.

## Summary task prefixes

Use only relationships that actually apply, joined with ` + `: `keyframe completion`, `reference generation`, `video editing`, `video continuation`, `audio reuse`, `audio reference`.

## Retention markers

Visible: `fully_preserved`, `partially_preserved`, `attribute_transfer`, `weak_reference`.

Audio: `fully_copy`, `partially_copy`, `reference`, `weak_reference`.

Apply a marker only within the label role already defined. New target actions or plot events are not losses of fidelity.

## Detailed description

- Establish overall style in one or two English sentences before `[Shot 1]`.
- Use base-mode shot, timestamp, camera, speaker, dialogue, and sound rules.
- Cite labels naturally where they take effect: `the shot begins from <Picture 1>`, `the shot ends on <Picture 2>`.
- At a Subject's first clear appearance, describe its visible referenced characteristics, frame position, and action.
- When a referenced subject speaks, write `<Subject N> (Sx)`; the Subject label and speaker ID serve different purposes.
- If audio is only a cue inside copied music/soundtrack, cite `<Audio N>` and do not invent a speaker.
- Preserve exact reused or explicitly reperformed dialogue; use `[unclear]` rather than guessing.
- Generation descriptions are normally 350–500 English words, but timeline completeness outranks a mechanical word target.
