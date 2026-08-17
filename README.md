# Rambo AI Film

Public, text-only production memory for a cinematic AI-video project built with Higgsfield. The repository records intent, continuity, prompts, Character Element metadata, reference hashes, generation lineage, evaluations and handoffs. Personal images, video, audio and edit files are never stored here.

Start with START_HERE.md. Agent-specific operating rules live in AGENTS.md.

## Current checkpoint

SEQ01 / SH010 — clandestine radio hut

- V2A: preferred body anatomy and skin baseline.
- V3: face, framing, hut composition and eye-led turn approved; tattoo, body hair and head/body proportions rejected.
- V4: prompt complete, corrected Element available, one generation authorized but not launched.
- Exact active Element: @char_char_martino-completo-corpo_v3_V3

See HANDOFF.md for the live state.

## Repository map

- AGENTS.md — automatic operating instructions for future coding agents.
- START_HERE.md — universal onboarding and read order.
- HANDOFF.md — smallest complete live checkpoint.
- PROJECT_BRIEF.md — stable scope, workflow and generation gate.
- PROJECT_STATUS.md — current production state.
- CONTINUITY_BIBLE.md — character, performance and visual invariants.
- story/ — source master, shot placeholders and audio plan.
- shots/ — immutable per-generation run, lineage and review records.
- prompts/ — immutable prompt versions.
- registry/ — Elements, generated outputs and active shot index.
- docs/REFERENCE_ASSETS.md — external media names and SHA-256 fingerprints.
- docs/playbooks/INDEX.md — task-to-skill routing and source fingerprints.
- .agents/skills/ — project-shared acting, image and video-prompt workflows.
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

