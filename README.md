# AI Video Director

Public, text-only control plane for multiple AI-video projects. It combines a local MiniMax H3/ComfyUI director harness with provider-aware prompt skills and preserves production memory for Higgsfield projects. Personal images, video, audio and edit files are never stored here.

<!-- AI-BOOT:BEGIN -->
## AI-BOOT (Wiki-LLM Lean 9.5)

This block teaches HOW to find state. It contains no live state.

### CORE BOOT

1. Remote `main` HEAD is repository authority.
2. Read this AI-BOOT block.
3. Read `docs/runtime/CURRENT_FRONTIER.md` (only project LIVE STATE).
4. Follow the ONE ACTIVE WORK pointer (Active Workboard issue).
5. Read only your specialist lane.
6. Read only SYNC V1 comments addressed to your role after your lane `LAST_SYNC` (`NONE` or comment URL; not ISO time).
7. Follow only explicitly pointed evidence.
8. STOP at the first real gate, or continue via AUTO-VIA.

### AUTO-VIA

Continue the deterministic pointer chain without asking the user to repeat documented context. Stop only for real authorization, missing input, or authority conflicts.

### agg (refresh, not reboot)

remote HEAD → CURRENT_FRONTIER → Workboard → own lane → addressed SYNC events after LAST_SYNC → pointed evidence only → resume.

### CONTEXT GUARD

Do not preload all issues, all history, old handoffs, full Harness internals, cinematic history, or all LoRA evidence unless the current lane explicitly requires them.

### SCOPE-AWARE AUTHORITY

| Scope | Owner |
|---|---|
| Bootstrap routing | README AI-BOOT |
| Cross-track live state | `docs/runtime/CURRENT_FRONTIER.md` |
| Specialist active state | Workboard lane |
| Shot / generation / asset facts | `registry/*`, run/lineage/review, `docs/REFERENCE_ASSETS.md` |
| Rules / safety / machine invariants | CONTRACT (`AGENTS.md`, operating rules, runtime contracts) |
| Procedure / practice | METHOD (skills, manuals, #58 Phase 2/3 when active) |
| Experimental results | EVIDENCE (e.g. #69) |
| Past state | HISTORY (`CHANGELOG.md`, logs, closed PRs/issues) |

On same-scope contradiction: STOP and report. Do not let one scope override another.

Roles and seeds: `docs/foundation/SPECIALIST_ROLES.md`.  
Sync contract: `docs/contracts/CROSS_CHAT_SYNC_V1.md`.  
Repo coding agents also follow `AGENTS.md`.
<!-- AI-BOOT:END -->

## Live state pointer

Cross-track live state: **`docs/runtime/CURRENT_FRONTIER.md`**.  
Do not treat this README, START_HERE.md, or HANDOFF.md as the project LIVE STATE owner.

Human onboarding still: START_HERE.md. Agent operating contract: AGENTS.md.

## Repository map

- AGENTS.md — automatic operating instructions for future coding agents.
- START_HERE.md — universal onboarding and read order.
- HANDOFF.md — production-track handoff detail (declassified; not cross-track LIVE STATE).
- PROJECT_BRIEF.md — stable scope, workflow and generation gate.
- PROJECT_STATUS.md — production-track status detail (declassified).
- CONTINUITY_BIBLE.md — character, performance and visual invariants.
- docs/runtime/CURRENT_FRONTIER.md — only project-level LIVE STATE.
- docs/foundation/SPECIALIST_ROLES.md — specialist role charters and seeds.
- docs/contracts/CROSS_CHAT_SYNC_V1.md — cross-chat sync contract.
- story/ — source master, shot placeholders and audio plan.
- shots/ — immutable per-generation run, lineage and review records.
- prompts/ — immutable prompt versions.
- registry/ — Elements, generated outputs and active shot index.
- docs/REFERENCE_ASSETS.md — external media names and SHA-256 fingerprints.
- docs/playbooks/INDEX.md — task-to-skill routing and source fingerprints.
- .agents/skills/ — project-shared acting, image and video-prompt workflows.
- comfyui-harness/ — local MiniMax H3 workflow launcher over ComfyUI HTTP/WebSocket APIs, including Text to Video, Image to Video, First & Last Frame to Video, and Reference Images to Video.
- decisions/ — architecture and production decision records.
- logs/ — dated chronological work log.
- templates/ — reusable production records.
- scripts/ — validation tools.
- .github/workflows/ — automatic repository checks.

## Public safety rule

Only text, hashes and non-secret technical metadata belong here. Never commit photographs, clips, audio, local paths, Library/upload IDs, credentials or unnecessary personal data.

## Validation

Run:

    python3 scripts/validate_project.py

MiniMax H3 local setup is documented in `docs/COMFYUI_H3_SETUP.md`.
