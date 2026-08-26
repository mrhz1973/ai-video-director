# CROSS_CHAT_SYNC_V1

Contract for specialist-chat synchronization via the Active Workboard issue ([#75](https://github.com/mrhz1973/ai-video-director/issues/75)).

GitHub is the sync bus. Chat context is temporary working memory.

## Transport

- **Workboard body** = current snapshot of the four specialist lanes (ACTIVE STATE).
- **Workboard comments** = append-only SYNC V1 events (delta transport).
- Do **not** rewrite previous sync comments.
- No heavier event system in v1.

## Event schema

```text
SYNC V1
FROM: <ROLE>
TO: <ROLE>[, <ROLE>...]
REF: <canonical issue|path|commit|PR|asset record>
CHANGE: <1–2 lines>
IMPACT: <what it affects>
ACTION: <requested action or none>
```

Roles: `HARNESS_ENGINEERING` | `IMAGE_ELEMENT_DIRECTOR` | `VIDEO_DIRECTOR` | `MASTER_FILM_DIRECTOR`

## MUST emit

Emit a SYNC V1 comment when a role lands a **canonical** change another role consumes, including:

- approved asset / continuity change
- Harness capability change that affects production
- evidence / method / contract change affecting another role
- gate pass/fail that unblocks another role

## MUST NOT emit

- internal reasoning
- drafts not yet canonical
- duplicated canonical content
- progress with no cross-role impact

## LAST_SYNC

Per-lane field on the Workboard body:

- `LAST_SYNC: NONE` — consume from the beginning of the Workboard comment stream
- `LAST_SYNC: <GitHub Workboard comment URL>` — exact audit cursor (optional comment ID may be noted)

**Do not** use ISO timestamps as the authoritative cursor.

### Consumption

1. Read only SYNC V1 comments **addressed to this role** (`TO:` includes the role).
2. Restrict to comments that come **after** the comment referenced by `LAST_SYNC` (`NONE` = from the start).
3. Act on pointed REFs as needed.
4. After successful consumption/action, advance **only this lane's** `LAST_SYNC` to the newest successfully consumed **addressed** comment.
5. Unaddressed comments do **not** advance the cursor.
6. A second `agg` with no newer addressed events reports **no relevant deltas**.

## Authority

- A SYNC event is a **pointer/delta**, never the source of truth.
- The `REF` remains canonical for the underlying fact, asset, evidence, contract or decision.
- If a SYNC comment contradicts its `REF`, the **REF wins**.
- If two canonical owners claim the **same scope** and contradict → **STOP and report**.

## Deduplication

Do not re-emit an identical `REF` + `CHANGE`. Consumers treat duplicates as idempotent.

## Writing discipline

1. Each role edits **only** its own lane block in the Workboard body.
2. SYNC comments are append-only.
3. If the specialist chat has authorized GitHub write capability → update own lane and append SYNC events directly.
4. If not → output the **exact lane patch** and/or **exact SYNC V1 payload** for an authorized agent/scribe. Do not require the user to reconstruct the message.

## Collision strategy (v1)

Keep one Workboard issue body. If multi-writer body collisions become a recurring observed problem, a future fallback may use one pinned lane comment per role. Do **not** introduce that complexity in v1.

## Lifecycle

SYNC comments remain as audit history. No automatic retention/cleanup machinery in v1.
