# Wave 3 — SYSTEM panel decision

**TASK_REF:** #95  
**DECISION:** `NOT_IMPLEMENTED_BY_DESIGN`  
**DATE:** 2026-08-26

## Evidence reviewed (v0.19.2 baseline)

| Concern | Current placement |
|--------|-------------------|
| GPU status / power profiles | Inspector header (`gpu-power-ui.mjs`, compact context class) |
| ComfyUI connection badge | SCENA monitor strip (`connection-badge.mjs`) |
| Queue counts / progress | SCENA render monitor (`monitor.mjs`) |
| Technical event feed | SCENA activity drawers (Eventi / Terminale) |
| OUTPUT gallery/list + filters | OUTPUT workspace (`output-ui.mjs`, `output-view.mjs`) |
| CODA filters / recovery | CODA workspace (`coda-filters.mjs`) |
| Contextual Inspector | Wave 2 (`inspector-context.mjs`, `inspector-ui.mjs`) |
| Batch operator controls | BATCH workspace (prepared vs history separation) |

## Rationale

A dedicated SYSTEM tab/panel would **duplicate** read-only runtime surfaces already contextualized next to the operator task (SCENA monitor for live execution, Inspector for GPU, OUTPUT/CODA for artifacts and recovery). Wave 1/2 architecture keeps creative workflows primary and technical controls secondary without adding a third navigation axis.

Constraints preserved:

- ComfyUI lifecycle remains external to the harness.
- No duplicate Generate/Batch/queue execution authority.
- GPU controls stay secondary (Inspector, not global modal).
- Contextual Inspector remains the detail surface for selected OUTPUT/CODA items.

## Outcome

Wave 3 does **not** introduce a SYSTEM panel. Future work should revisit only if operator confusion or duplicated controls are demonstrated with acceptance evidence—not merely to close legacy tickets.
