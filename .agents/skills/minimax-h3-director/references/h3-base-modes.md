# H3 base modes

Source of truth: MiniMax-AI/MiniMax-H3 `skills/h3-prompt-writing/references/base-en.txt`.

## Exact output order

T2VA begins directly with the three fields. Image-conditioned modes begin with the exact applicable alignment line, then one blank line.

I2VA:

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

FL2VA:

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

L2VA:

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

Replace `N` with the actual final shot index and `S.SS` with the effective duration to exactly two decimals.

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## Timeline rules

- Start with `[Shot 1]` and no timestamp.
- Later cuts begin `[Shot N] At MM:SS.mmm,` with sequential numbers and strictly increasing times inside the duration.
- I2VA: establish Picture 1's style, composition, subjects, clothing, colors, objects, and spatial relationships, then develop forward.
- FL2VA: describe a continuous physical path from Picture 1 to Picture 2; progressively reduce differences and land exactly on the last frame.
- L2VA: infer a plausible compatible opening and converge to Picture 1 at the end.
- A cut must add new information; use camera motion for a small distance or angle change.
- Camera motion is natural English: motion type, plus amplitude and speed only when meaningful.

## Speech and sound

- Assign `(S1)`, `(S2)` only to sources that vocalize, in first-vocal-event order, and reuse IDs across shots.
- Put only language and exact words inside `<d>`, e.g. `<d>[Italian] Non muoverti.</d>`.
- For voiceover use `says in an off-screen voiceover` and immediately state that the visible character's lips remain completely closed.
- Use `<scenetrans>` where the same dialogue crosses a cut and `<cutoff>` when the video truncates it.
- Visible text is copied verbatim in English double quotes.
- `overall_soundscape` is a 1–4 sentence summary of ambience, action sounds, and non-verbal human sound. Do not repeat dialogue or singing.
- `non_diegetic_music` is a 1–3 sentence description of audience-only music by instrumentation, tempo, rhythm, and dynamics. Diegetic radio/TV/instrument music stays in the timeline.
