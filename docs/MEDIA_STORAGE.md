# Media storage policy

## Git repository

Store:
- prompts
- project briefs
- decision records
- Element handles and provider IDs
- generation metadata
- SHA-256 hashes
- small text-based manifests

Do not store:
- original personal photographs
- MP4 renders
- high-resolution PNG or JPEG references
- WAV files
- editing project caches
- model downloads

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

Use the generation key from registry/generations.csv in filenames and notes. Keep at least two independent copies of approved masters.
