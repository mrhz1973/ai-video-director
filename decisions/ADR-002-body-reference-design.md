# ADR-002 — Martino body reference design

Date: 2026-08-17
Status: accepted after V3 correction cycle

## Initial attempt

The V2 Element used a body sheet that allowed artificial hair and tattoo reinterpretation. Cropping both full-body views at the neck also removed the anatomical bridge between head, neck and shoulders.

## Evidence

V3 produced excellent facial identity and framing but enlarged the head, narrowed the body, invented torso hair and redesigned the tattoo. A later generated headless body plate still retained hair and altered the tattoo.

## Final decision for V4

Use role-separated references inside a new versioned Element:

- facial portraits control the complete head and identity;
- a lateral three-quarter neck-down body reference controls shoulder breadth, torso scale, moderate muscularity and naturally hairless skin;
- the exact two-angle tattoo reference alone controls tattoo artwork, fade, color, scale, rotation and position;
- BODY_PROPORTIONS_MASTER and V2A remain comparison evidence, not competing identity sources.

The lateral body crop deliberately removes the head so it cannot compete with the approved facial portraits. The prompt explicitly restores a normal adult head-to-body ratio.

## Active implementation

Element: @char_char_martino-completo-corpo_v3_V3
Body reference: BODY_SIDE_HEADLESS_HAIRLESS_V3
Tattoo reference: TATTOO_EXACT
Prompt: prompts/SEQ01/SH010/v04-prompt.md

