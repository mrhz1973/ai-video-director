# LAST_CURSOR_REPORT

TASK_REF: #100 / v0.19.6 production deployment
STATUS: PASS
EVIDENCE_STATE: EVIDENCE_COMPLETE
TARGET_VERSION: 0.19.6
RELEASE_SHA: bd8cdd026fd1b2015b09135f6d18bfd595bbdf13
PRIOR_PRODUCTION_SHA: 0617a68a8152bb073ace8ea51ac3375292779c11
DEPLOY_AUTHORIZATION: 5457940683
WORKBOARD_SYNC: 5457944867
SOURCE: Cursor Agent (#100 deploy)
RUNTIME_TOUCHED: YES (dedicated stable-runtime Director-only deploy)

## SUMMARY

DEPLOYMENT_PASS. Permanent #97 path advanced dedicated stable runtime to exact release `bd8cdd` / v0.19.6. Persistent 14-project store preserved. ComfyUI PID unchanged. First attempt failed because session `H3_CONFIG_PATH` still pointed at Controlled Acceptance temp config (port 8788); exact wrong-port PID stopped; env cleared; permanent deploy re-run completed PASS.

## AUTHORITY

- Deploy authorization: #100 comment 5457940683
- Exact release SHA: `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`
- Expected version: 0.19.6
- Tooling: Deploy-AIVideoDirectorRuntime.ps1 + deploy-runtime-cli.mjs

## PREFLIGHT

- Stable: `0617a68` clean detached 0.19.5
- Director PID: 24764 / 0.19.5
- Comfy PID: 17940 healthy
- Queue: 0/0
- Desktop: stable-runtime Start-AIVideoDirector.ps1 + WorkingDirectory stable harness
- Projects: 14; hashes snapshotted; issue-73 absent
- PLAN: PASS (checkout_and_restart)

## DEPLOY

- Old stable SHA: `0617a68`
- New stable SHA: `bd8cdd` (clean detached, package 0.19.6)
- Director old PID: 24764 (stopped exact-PID)
- First spawn anomaly: PID 44632 listened on 8788 due to polluted `H3_CONFIG_PATH`; stopped exact PID; cleared env
- Director new PID: 42596 on 8787
- Comfy before/after: 17940 / 17940

## FINAL

- /api/health 0.19.6; /api/config 0.19.6; UI version surface 0.19.6
- projectStore: H3_PROJECT_DIRECTORY, persistent true
- /api/projects = 14; /api/config.projects = 14
- Representative loads OK: martino-capanna-radio-escape-sequence, rambo, portovenere-test
- Project hashes unchanged YES
- Queue 0/0; GPU mode normal / 170 W unchanged; POST /api/gpu-power = 0
- Desktop unchanged; Comfy lifecycle = 0

## SIDE EFFECTS

generation=0 upload=0 POST /prompt=0 POST /api/queue=0 queue mutation=0 GPU mutation=0 project mutation=0 migration APPLY=0 Desktop rewrite=0 ComfyUI lifecycle=0 broad kill=0

## NEXT_RELEVANCE

Orchestrator agg may close #100 / update frontier after reading this report and PR #101 deployment evidence.
