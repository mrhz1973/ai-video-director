#!/usr/bin/env python3
"""Validate the public, text-only project memory."""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "AGENTS.md",
    "START_HERE.md",
    "HANDOFF.md",
    "PROJECT_BRIEF.md",
    "PROJECT_STATUS.md",
    "CONTINUITY_BIBLE.md",
    "docs/REFERENCE_ASSETS.md",
    "docs/playbooks/INDEX.md",
    "registry/elements.yaml",
    "registry/generations.csv",
    "registry/shots.csv",
    "prompts/SEQ01/SH010/v04-prompt.md",
    "shots/SEQ01/SH010/G003/run.yaml",
    "shots/SEQ01/SH010/G003/review.md",
    "shots/SEQ01/SH010/G003/lineage.yaml",
    "shots/SEQ01/SH010/G004/run.yaml",
    "shots/SEQ01/SH010/G004/review.md",
    "shots/SEQ01/SH010/G004/lineage.yaml",
    ".agents/skills/minimax-h3-director/references/H3_OFFICIAL_NOTES.md",
    "apps/comfyui-harness/README.md",
    "apps/comfyui-harness/config.example.json",
    "apps/comfyui-harness/server.py",
    "apps/comfyui-harness/static/index.html",
    "apps/comfyui-harness/workflows/README.md",
]

SKILLS = {
    "acting-performance": ".agents/skills/acting-performance/SKILL.md",
    "lira-image-prompts": ".agents/skills/lira-image-prompts/SKILL.md",
    "cinedance-higgsfield": ".agents/skills/cinedance-higgsfield/SKILL.md",
    "minimax-h3-director": ".agents/skills/minimax-h3-director/SKILL.md",
    "video-director-router": ".agents/skills/video-director-router/SKILL.md",
}

FORBIDDEN_SUFFIXES = {
    ".mp4", ".mov", ".mkv", ".avi", ".wav", ".aif", ".aiff", ".flac",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".tif", ".tiff",
    ".psd", ".psb", ".prproj", ".drp", ".zip",
}

SENSITIVE_PATTERNS = {
    "local workspace path": re.compile("/work" + "space/"),
    "library identifier": re.compile(r"\blibfile_[a-z0-9]+\b", re.I),
    "upload identifier": re.compile(r"\bfile_0{4,}[a-z0-9]+\b", re.I),
    "OpenAI-style secret": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    "bearer token": re.compile(r"\bBearer\s+[A-Za-z0-9._~-]{12,}", re.I),
}

SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACTIVE_ELEMENT = "@char_char_martino-completo-corpo_v3_V3"

errors: list[str] = []

for rel in REQUIRED:
    if not (ROOT / rel).is_file():
        errors.append(f"missing required file: {rel}")

for path in ROOT.rglob("*"):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT)
    if any(part in {".git", "__pycache__"} for part in rel.parts):
        continue
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        errors.append(f"forbidden media/binary file: {rel}")
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        errors.append(f"non-UTF-8 or binary file: {rel}")
        continue
    for label, pattern in SENSITIVE_PATTERNS.items():
        if pattern.search(text):
            errors.append(f"{label} found in {rel}")

for name, rel in SKILLS.items():
    path = ROOT / rel
    if not path.is_file():
        errors.append(f"missing project skill: {rel}")
        continue
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        errors.append(f"invalid skill frontmatter: {rel}")
        continue
    keys = []
    for line in match.group(1).splitlines():
        if line and not line.startswith((" ", "\t")) and ":" in line:
            keys.append(line.split(":", 1)[0].strip())
    if keys != ["name", "description"]:
        errors.append(f"skill frontmatter must contain only name and description: {rel}")
    if f"name: {name}" not in match.group(1):
        errors.append(f"skill name mismatch: {rel}")

prompt = ROOT / "prompts/SEQ01/SH010/v04-prompt.md"
if prompt.is_file():
    ptext = prompt.read_text(encoding="utf-8")
    if ACTIVE_ELEMENT not in ptext:
        errors.append("active Element missing from V4 prompt")

for rel in ["HANDOFF.md", "PROJECT_STATUS.md", "registry/elements.yaml", "registry/shots.csv"]:
    path = ROOT / rel
    if path.is_file() and ACTIVE_ELEMENT not in path.read_text(encoding="utf-8"):
        errors.append(f"active Element missing from {rel}")

g004 = ROOT / "shots/SEQ01/SH010/G004/run.yaml"
if g004.is_file():
    text = g004.read_text(encoding="utf-8")
    for expected in [
        "status: authorized_not_launched",
        "consumed: false",
        "file_name: null",
        "sha256: null",
    ]:
        if expected not in text:
            errors.append(f"G004 planned-run invariant missing: {expected}")

assets = ROOT / "docs/REFERENCE_ASSETS.md"
if assets.is_file():
    for line in assets.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or "SHA-256" in line or line.startswith("|---"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) >= 3 and not SHA256.fullmatch(cells[2]):
            errors.append(f"invalid SHA-256 in REFERENCE_ASSETS.md: {cells[0]}")

generations = ROOT / "registry/generations.csv"
if generations.is_file():
    with generations.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required_columns = {
        "generation_key", "file_name", "sha256", "verdict", "element"
    }
    if not rows:
        errors.append("registry/generations.csv has no generation rows")
    elif not required_columns.issubset(rows[0]):
        errors.append("registry/generations.csv is missing required columns")
    for row in rows:
        if not SHA256.fullmatch(row.get("sha256", "")):
            errors.append(f"invalid generation SHA-256: {row.get('generation_key')}")

agents = ROOT / "AGENTS.md"
if agents.is_file() and len(agents.read_text(encoding="utf-8").splitlines()) > 180:
    errors.append("AGENTS.md is too long for fast onboarding")

if errors:
    print("Project validation failed:")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("Project validation passed.")
