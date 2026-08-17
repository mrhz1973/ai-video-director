# ADR-004 — Public repository data policy

Date: 2026-08-17
Status: accepted

## Context

The repository is public, but the project depends on personal reference photographs, generated media and provider-side resources.

## Decision

Keep the repository public and text-only.

Allowed:
- prompts, reviews and production decisions;
- neutral media filenames and SHA-256 hashes;
- Character Element handles and non-secret provider IDs;
- model names, settings, timing and lineage;
- project-shared Markdown playbooks.

Forbidden:
- photographs, video, audio or edit-project bytes;
- local filesystem paths;
- ChatGPT Library or upload identifiers;
- cookies, tokens, API keys, passwords or account exports;
- unnecessary personal contact or account information.

## Enforcement

.gitignore blocks common media and secret formats. scripts/validate_project.py scans the tracked text tree. GitHub Actions runs the validator on pushes and pull requests.

