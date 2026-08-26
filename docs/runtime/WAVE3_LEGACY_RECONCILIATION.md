# Wave 3 — legacy issue reconciliation

**TASK_REF:** #95  
**DATE:** 2026-08-26  
**NOTE:** GitHub issues are **not** closed in this pass; orchestrator applies bookkeeping after PR review.

| ISSUE | CURRENT_STATE | CLASSIFICATION | REMAINING_REQUIREMENT | RECOMMENDED_ACTION |
|-------|---------------|----------------|----------------------|-------------------|
| **#7** — render monitor / queue visibility | SCENA monitor shows progress, queue counts, terminal/events drawers; connection badge present | **SOLVED** | None for Wave 3 | Keep; regression covered by Wave 1/2 tests |
| **#15** — OUTPUT organization / naming | Wave 2 OUTPUT gallery/list, filters, grouping, archive/cloud semantics shipped | **PARTIALLY_SUPERSEDED** | `{date}` token in naming templates not implemented | Defer `{date}` unless product explicitly requests; do not add speculatively |
| **#6** — model selection / discovery | Wave 3 adds `h3-model-registry.mjs`, ComfyUI `object_info` discovery, friendly labels, missing-model unavailable state | **STILL_VALID → ADDRESSED IN #95** | Maintain registry when presets/checkpoints change | Merge Wave 3; extend tests when new presets added |
| **#4** — broader runtime/architecture | Harness ownership boundaries documented; no second harness | **STILL_VALID** | Deeper runtime unification out of Wave 3 scope | Track separately; do not rewrite architecture to close ticket |
| **#46** — operator UX backlog (tooltips, batch language, `{date}`) | Wave 1 global tooltips + Wave 2 batch chips/terminology; `{date}` and some naming items open | **PARTIALLY_SUPERSEDED** | Residual naming `{date}`; any stale help if controls change | Wave 3 extends tooltip inventory for model select; defer `{date}` |

## Cautions applied

- Did **not** implement `{date}` because #46/#15 mentions alone are insufficient product authorization.
- Did **not** add SYSTEM tab (see `WAVE3_SYSTEM_PANEL_DECISION.md`).
- Model discovery respects ComfyUI authority boundary (read-only `object_info`; no install/scan/restart).
