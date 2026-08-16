# ADR-001 — Hybrid project control plane

Date: 2026-08-17
Status: accepted

## Decision

Use Higgsfield as the live production environment, this private GitHub repository as the versioned project memory, and external storage as the media archive.

## Reason

Higgsfield manages Elements, project settings, Canvas workflows and generations. Git provides durable text history, diffs and provider-independent records. Large media files remain outside normal Git to prevent repository growth and exposure of personal reference imagery.
