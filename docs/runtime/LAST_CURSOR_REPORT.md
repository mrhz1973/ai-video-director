# LAST_CURSOR_REPORT

TASK_REF: #73
TASK: Single Render cannot be started again after completion without reload
ROLE: HARNESS_ENGINEERING
STATUS: PASS
EVIDENCE_STATE: EVIDENCE_COMPLETE
SOURCE: Cursor
BASE_MAIN_SHA: 744c17788970cbcc11387179cc18eaae1a57e3a4
WORK_REF: fix/issue-73-single-render-readiness
COMMIT: 43fb58101e059942763c33b95f58c345cd0c499b
PR: https://github.com/mrhz1973/ai-video-director/pull/82
VALIDATION: npm test 841 pass / 0 fail; python scripts/validate_project.py PASS
RUNTIME_TOUCHED: NO
SUMMARY: Verified root cause: rememberJob() clear stopped queue polling and left a stale queueRunning=1 sample, so resolveGenerateAction stayed on queue-next (Metti in coda) after terminal. Fix: keep queue polling after terminal clear; await reconcileQueueAfterTerminal() (authoritative /api/active refresh) after completed/failed/interrupted paths; helper post-terminal-queue.mjs. Does not blindly force 0/0. Canonical Director/ComfyUI untouched; no generation; no live acceptance/merge/deploy.
NEXT_RELEVANCE: Orchestrator review of #73 PR. Canonical runtime untouched. Controlled live acceptance / merge / deploy remain separate gates.
