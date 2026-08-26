# Martino Metamorphosis — Durable Reference Rules

Purpose: durable rules for future Martino age-metamorphosis Character Element work. Git stores metadata and decisions only; personal media remain outside Git.

## Naming

- Use short age codes in the form `M<age>`.
- Confirmed/expected examples include `M1`, `M2`, `M3`, `M4`, `M5`, `M10`, `M16`, `M35`, `M52`.
- Approximate batches may temporarily use the nearest practical node (for example `M4` for an estimated 3–4-year-old set) until the complete inventory supports finer age separation.
- Do not force the earliest canonical anchor to `M1` or `M5` yet. Choose it after the photo inventory shows which early-age group has the strongest and largest usable reference set.

## Identity constants

- No necklace / chain by default unless explicitly requested for a specific output.
- Real eye color authority: green.
- `M52` is the current eye-color master for all Martino age variants unless explicitly overridden.
- Preserve identity-relevant facial geometry across age variants; age progression/regression must not create a different person.

## Mixed-batch ingestion

- Mixed photo batches are allowed.
- For each image, track: age code, age confidence, beard state, view angle, source type, clothing/context, reference role, quality/usefulness, and status.
- If age classification is materially ambiguous, ask the user one short classification question instead of guessing.
- If beard state differs within the same age code, keep both variants as separate metadata; do not discard a useful identity angle only because facial hair differs.
- Do not over-split adjacent childhood ages prematurely. Prefer one robust provisional node when originals clearly belong to the same narrow developmental band, then refine after inventory.

## Early-age anchor decision

The starting anchor for the earliest metamorphosis stage (`M1` vs `M5`, or another early code) is intentionally deferred until inventory is sufficient. Prefer the age group with:

1. the highest number of usable originals;
2. the best angle coverage (front / 3-quarter / profile);
3. the strongest image quality;
4. the lowest reconstruction burden;
5. enough continuity to bridge reliably toward the next age group.

## Registry

Reference metadata is maintained in `docs/metamorphosis/MARTINO_REFERENCE_REGISTRY.csv`.