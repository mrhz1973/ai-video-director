---
name: video-ai-director
description: Route AI-film tasks in this repository to MiniMax H3, Higgsfield/CineDance, Acting, or Lira modules and combine only compatible guidance. Use for mixed video-prompt, reference-preparation, performance, provider-choice, or local ComfyUI requests.
---

# Video AI Director Router

Read project state and preserve the repository's source-of-truth and authorization rules before routing.

## Routing table

| Request signal | Primary module | Optional additions |
|---|---|---|
| MiniMax H3, T2VA, I2VA, FL2VA, L2VA, Ref2VA, H3 ComfyUI | `../minimax-h3-director/SKILL.md` | Acting for performance; CineDance for compatible blocking/camera/physics; Lira for preparing images |
| Higgsfield or Seedance generation prompt/review | `../cinedance-higgsfield/SKILL.md` | Acting for characters; Lira for reference-image preparation |
| Acting, reaction, dialogue behavior, eye-life | `../acting-performance/SKILL.md` | Provider module only if a final provider prompt is requested |
| Create or repair an image/reference/keyframe | `../lira-image-prompts/SKILL.md` | Provider module only after the image task is complete |
| Repository records only | Project `AGENTS.md` | No long creative manual unless content is being authored or judged |

## Composition rules

1. Load the primary module first, then only modules justified by the task.
2. Provider syntax is never blended. H3 field names and labels do not enter Higgsfield prompts; Higgsfield @tags and section architecture do not enter H3 prompts.
3. Acting contributes observable performance, not provider syntax.
4. Lira contributes reference preparation and role clarity, not video timeline syntax.
5. CineDance may contribute physical blocking, optics outcomes, camera, lighting, and physics only after translation into the primary provider's language.
6. When rules conflict, the active provider's official format wins; project continuity and exact user constraints remain binding.
7. A prompt-writing request does not authorize a paid generation or external provider action.
