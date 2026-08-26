# Wave 3 — CSS consolidation evidence

**TASK_REF:** #95 (PR #96 correction)  
**DATE:** 2026-08-26

## ACTIVE_STYLESHEETS_BEFORE

14 linked stylesheets (pre-correction PR head `6a73972`):

1. `style.css`
2. `design-system.css`
3. `output.css`
4. `workspace-resize.css`
5. `workspace-v081.css`
6. `workspace-v082.css`
7. `workspace-v083.css`
8. `workspace-v085.css`
9. `workspace-v0140.css`
10. `gpu-power.css`
11. `batch.css`
12. `tooltip.css`
13. `wave2.css`
14. `wave3.css` *(overlay-only; duplicate ownership)*

Historical versioned workspace layers (`v081`–`v085`, `v0140`) retained — each still carries unique layout/resize/lightbox rules verified by layout regression tests.

## ACTIVE_STYLESHEETS_AFTER

13 linked stylesheets:

1. `style.css`
2. `design-system.css` *(expanded shared authority)*
3. `output.css`
4. `workspace-resize.css`
5. `workspace-v081.css`
6. `workspace-v082.css`
7. `workspace-v083.css`
8. `workspace-v085.css`
9. `workspace-v0140.css`
10. `gpu-power.css`
11. `batch.css` *(batch layout only)*
12. `tooltip.css`
13. `wave2.css`

**Removed from index:** `wave3.css` — rules migrated into `design-system.css`; file deleted.

## DUPLICATED_SHARED_RULE_GROUPS_BEFORE

| Group | Locations |
|-------|-----------|
| Secondary/destructive button colors + hover | `style.css`, `design-system.css` |
| `button:disabled` opacity/cursor | `style.css`, `design-system.css` |
| Save-status semantic colors | `style.css`, `design-system.css` |
| Batch badge/chip surfaces | `batch.css`, `design-system.css` |
| CODA filter button base + active | `batch.css`, `design-system.css` |
| Batch feedback ok/warn/error colors | `batch.css`, `design-system.css` |

**Count:** 6 duplicated shared rule groups across legacy + design-system layers.

## DUPLICATED_SHARED_RULE_GROUPS_AFTER

| Group | Authority |
|-------|-----------|
| Secondary/destructive buttons | `design-system.css` only |
| Disabled control state | `design-system.css` only |
| Save-status semantic colors | `design-system.css` only |
| Batch badge/chip | `design-system.css` only |
| CODA filter button | `design-system.css` only |
| Batch feedback semantic colors | `design-system.css` only |

**Count:** 0 cross-file duplicates for these groups.  
**Remaining layout-specific overrides (intentional):** `workspace-v085.css` `.prompt-actions button.secondary { width: auto }` — geometry-only, not color/state duplication.

## LEGACY_LAYER_RULES_MIGRATED

Into `design-system.css`:

- `#version` header styling (from `wave3.css`)
- `.generation-grid label small.h3-model-hint` display (from `wave3.css`)
- `.coda-filter-btn` base styles (from `batch.css`)
- `.coda-filter-btn.active` background (from `batch.css`)
- `.batch-badge` typography/spacing (from `batch.css`)
- `.batch-feedback[data-kind=*]` semantic colors (from `batch.css`)
- Project-grid secondary/danger layout sizing (from `style.css`, paired with existing color tokens)

## LEGACY_LAYER_RULES_REMOVED

From `style.css`:

- `button.secondary, button.danger { … colors/borders … }`
- `button:disabled { opacity; cursor }`
- `.save-status[data-state=saved|dirty|saving|error]` color rules

From `batch.css`:

- `.batch-badge { … border/color … }` duplicate surface
- `.batch-job-chip` / `.batch-job-chip-override` duplicate surfaces
- `.coda-filter-btn` + `.coda-filter-btn.active` duplicate rules
- `.batch-feedback[data-kind=ok|warn|error]` duplicate colors

From `index.html`:

- `<link rel="stylesheet" href="wave3.css">`

File deleted: `public/wave3.css`

## Visual / behavior preservation

- Dark theme + orange accent unchanged (token-sourced)
- Wave 1/2 workspace geometry unchanged (versioned workspace CSS retained)
- No aesthetic redesign; mechanical deduplication only
