# H3 official operational notes

Last verified: 2026-08-19.

Source priority: the public MiniMax H3 repository and its bundled
`h3-prompt-writing` skill. If this summary conflicts with upstream MiniMax
documentation, upstream wins.

## Modes

MiniMax documents five prompt-writing modes: T2VA, I2VA, FL2VA, L2VA and
full-reference Ref2VA.

Base modes use these three fields in order:

1. `integrated_multimodal_description`
2. `overall_soundscape`
3. `non_diegetic_music`

I2VA adds a first-frame alignment instruction before those fields. FL2VA adds a
first/last-frame alignment instruction. L2VA adds a last-frame alignment
instruction. The official wording and duration formatting must be preserved
when generating the final prompt.

Shot 1 has no timestamp. Later shots use the official `[Shot N] At
MM:SS.mmm, ...` form. FL2VA normally favors one continuous shot unless cuts
are explicitly required.

## Ref2VA

Full-reference mode uses exactly these sections, in this order:

1. `subject_definitions`
2. `summary`
3. `retention_analysis`
4. `detailed_description`
5. `overall_soundscape`
6. `non_diegetic_music`

Stable reference labels are `<Subject N>`, `<Picture N>`, `<Video N>` and
`<Audio N>`. Their meaning must remain unchanged through every section.

Visible-reference retention markers are `fully_preserved`,
`partially_preserved`, `attribute_transfer` and `weak_reference`. Audio markers
are `fully_copy`, `partially_copy`, `reference` and `weak_reference`.

Ref2VA task relationships include keyframe completion, reference generation,
video editing, video continuation, audio reuse and audio reference. Use only
relationships that actually apply; file presence alone does not imply editing,
continuation or audio reuse.

## Language, dialogue and audio

Write structural prompt content in English while preserving dialogue, lyrics and
visible scene text in their original language. Use stable speaker IDs `(S1)`,
`(S2)` and so on. Dialogue and lyrics are written inside the official `<d>`
format.

`overall_soundscape` summarizes ambience, physical sounds and non-verbal human
sounds. `non_diegetic_music` contains only music audible to the audience rather
than the characters.

## Capability note

MiniMax describes H3 as omni-modal, accepting mixed text/image/video/audio
context and generating video with native stereo audio, with output advertised
up to 2K and up to 15 seconds. Runtime provider or local-workflow constraints
must still be treated as configuration facts rather than invented prompt rules.

## Repository integration

H3 owns H3 output format. Acting Performance may contribute observable acting
behavior. CineDance may contribute compatible camera, blocking and physics
logic. Lira may prepare still reference assets. None of them may replace H3's
field names, section order, timing syntax or reference semantics.