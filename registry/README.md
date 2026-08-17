# Registries

- elements.yaml stores exact Character Element handles and their roles.
- shots.csv indexes current shot state and active prompt.
- generations.csv lists outputs that actually exist.

Do not add a planned run to generations.csv. Planned and executed run metadata lives under shots/SEQ01/SH010/Gxxx. Append generations.csv only after an output file exists and its SHA-256 has been computed.

