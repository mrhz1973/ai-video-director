# Project brief

Updated: 2026-08-17

## Working title

Rambo AI Film

## Purpose

Rebuild a roughly 30-second cinematic jungle-action sequence with consistent AI-generated visuals, replacing the protagonist's identity with Martino while preserving shot intent, timing, physical continuity and the original source audio during final local assembly.

## Production approach

- Generate silent visual shots in Higgsfield.
- Work shot by shot, currently in five-second blocks.
- Preserve approved details through explicit Character Elements, reference hierarchy, prompts, reviews and SHA-256 fingerprints.
- Reinsert the exact source audio locally after picture assembly; do not ask the video model to recreate it.
- Keep provider state and media external. Keep reproducible text records in GitHub.

## Current platform and settings

- Platform: Higgsfield
- Model lane: Cinema Studio 4.0
- Working aspect ratio: 16:9
- Active shot duration: 5 seconds
- Active audio state: off
- Active format: one continuous real-time take

## Source-of-truth hierarchy

1. Immutable prompt, run, lineage and review records for executed generations.
2. HANDOFF.md and PROJECT_STATUS.md for current state.
3. CONTINUITY_BIBLE.md for character and shot invariants.
4. Registry files for exact handles, generated outputs and active prompt.
5. External media verified by filename and SHA-256.
6. Higgsfield for live Elements, settings and generations not yet exported.

## Public repository boundary

The repository is public and contains no image, video or audio bytes. It may contain Element handles, non-secret provider IDs, filenames, hashes, prompt text and evaluations. It must never contain credentials, local paths, Library IDs or personal source media.

## Cost and external-action gate

Preparation, analysis and repository work are allowed. Each paid Higgsfield generation requires the user's exact written phrase:

AUTORIZZO LA GENERAZIONE

Authorization is scoped to one documented run unless the user clearly states otherwise. G004 is currently authorized but not launched.

