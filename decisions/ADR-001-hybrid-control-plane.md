# ADR-001 — Hybrid project control plane

Date: 2026-08-17
Status: accepted, amended for public visibility

## Decision

Use Higgsfield as the live production environment, this public GitHub repository as the text-only versioned project memory, and external storage as the private media archive.

## Reason

Higgsfield manages Character Elements, live settings, Canvas workflows and generations. GitHub provides durable history, diffs, handoffs, validation and provider-independent records. Large or personal media remains outside Git to prevent repository growth and public exposure.

## Consequence

Every external media asset is represented only by a neutral filename, role and SHA-256. No local path, Library ID, upload ID, media bytes or credential may enter the repository.

