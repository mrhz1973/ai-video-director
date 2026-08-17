# Media storage policy

## Public GitHub repository

Store only:
- prompts and project briefs;
- decision records;
- Element handles and non-secret provider IDs;
- generation metadata and lineage;
- SHA-256 hashes;
- small text manifests and reusable playbooks.

Never store:
- original personal photographs;
- generated stills or MP4 renders;
- source or final audio;
- editing projects and caches;
- local paths, Library IDs or upload IDs;
- credentials or account exports.

## External media layout

Recommended structure:

RAMBO_AI_FILM_MEDIA/
- 00_INBOX/
- 01_REFERENCES/CHARACTERS/MARTINO/
- 01_REFERENCES/TATTOO/
- 02_GENERATIONS/SEQ01/SH010/
- 03_APPROVED/
- 04_EDITING/
- 05_AUDIO/
- 99_BACKUP/

Use generation keys such as G003 and G004 in filenames and notes. Keep at least two independent copies of approved masters. Verify every asset by SHA-256 before use.

## Linking rule

Repository records may name an external file but must not expose its machine path, cloud Library ID or share URL. The filename plus SHA-256 is the portable identity.

