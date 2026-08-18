# Project playbooks

The uploaded manuals and project-local provider skills are versioned as shared agent skills. Long source manuals live one level below their SKILL.md when applicable so a future agent loads only the relevant system.

| Task | Required project skill | Full reference / source |
|---|---|---|
| Create, edit or debug a character/body/tattoo reference image prompt | .agents/skills/lira-image-prompts/SKILL.md | references/LIRA_FULL.md |
| Design or repair observable character performance | .agents/skills/acting-performance/SKILL.md | references/ACTING_SYSTEM.md |
| Write or review Higgsfield/Seedance video prompts | .agents/skills/cinedance-higgsfield/SKILL.md | references/CINEDANCE_FULL.md |
| Write or review MiniMax H3 T2VA/I2VA/FL2VA/L2VA/Ref2VA prompts | .agents/skills/minimax-h3-director/SKILL.md | references/H3_OFFICIAL_NOTES.md + upstream MiniMax H3 prompt-writing skill |
| Route an ambiguous or cross-provider image/video task | .agents/skills/video-director-router/SKILL.md | provider skill selected by router |
| Configure or launch local ComfyUI API workflows | apps/comfyui-harness/README.md | apps/comfyui-harness/workflows/README.md |

## Original uploaded manual fingerprints

| Manual | SHA-256 of uploaded source |
|---|---|
| Lira | f480d1ad5b61f7b33df3bc49e1b652e50a9a75acef280c8893facd6cb40eee83 |
| Acting | 8841c5d1155ee9347d5fc302a2f0fdac76fed21070c94bf01741821ea1c42365 |
| CineDance | 7b0e4f8dad1515631f54b6b6401b333adbdbbe3b8832a71c6ac78fe5d20b95f8 |

## Routing

- Image reference preparation: Lira only.
- Video acting beats: Acting Performance.
- Final Higgsfield/Seedance video prompt: CineDance plus Acting Performance when characters perform.
- Final MiniMax H3 prompt: H3 Director owns mode, fields, labels, timing and audio schema; add Acting Performance for characters.
- H3 may consult CineDance only for compatible camera/blocking/physics diagnostics; H3 output structure always wins.
- Generation review: provider skill for schema/camera/continuity plus Acting Performance for intention, beats, listening and eye life.
- Local ComfyUI execution: use the harness documentation after the provider prompt is final.
- Repository-only maintenance: AGENTS.md and project files; do not load long manuals unless the content task needs them.

Read the selected SKILL.md completely. It will state when a full reference must also be read.
