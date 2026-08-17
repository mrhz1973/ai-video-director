# Project playbooks

The three uploaded manuals are versioned as project-shared agent skills. Their full original text lives one level below each SKILL.md so a future agent loads only the relevant system.

| Task | Required project skill | Full reference | SHA-256 of uploaded source |
|---|---|---|---|
| Create, edit or debug a character/body/tattoo reference image prompt | .agents/skills/lira-image-prompts/SKILL.md | references/LIRA_FULL.md | f480d1ad5b61f7b33df3bc49e1b652e50a9a75acef280c8893facd6cb40eee83 |
| Design or repair observable character performance | .agents/skills/acting-performance/SKILL.md | references/ACTING_SYSTEM.md | 8841c5d1155ee9347d5fc302a2f0fdac76fed21070c94bf01741821ea1c42365 |
| Write or review Higgsfield/Seedance video prompts | .agents/skills/cinedance-higgsfield/SKILL.md | references/CINEDANCE_FULL.md | 7b0e4f8dad1515631f54b6b6401b333adbdbbe3b8832a71c6ac78fe5d20b95f8 |

## Routing

- Image reference preparation: Lira only.
- Video acting beats: Acting Performance.
- Final Higgsfield video prompt: CineDance plus Acting Performance.
- Generation review: CineDance for camera, blocking, physics and continuity; Acting Performance for intention, beats, listening and eye life.
- Repository-only maintenance: AGENTS.md and the project files; do not load the long manuals unless the content task needs them.

Read the selected SKILL.md completely. It will state when the full reference must also be read.

