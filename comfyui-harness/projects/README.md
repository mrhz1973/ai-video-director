# Local projects

Project files ending in `.local.json` hold private prompt text and the filenames of media already uploaded to the user's local ComfyUI input directory. They are intentionally ignored by Git.

A local project may define:

- `id`, `label`, and `workflowId`;
- sidebar `settings`;
- a structured H3 `prompt`;
- a `files` map whose keys match the selected preset's attachment keys.

The harness reads these files at startup and exposes them only through the loopback-only local UI. Never commit a local project file or place credentials, original media, or absolute filesystem paths in the public repository.
