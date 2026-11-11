# Pinned Exhume MCP server

`exhume-mcp.mjs` is a byte-for-byte copy of `power/server/exhume-mcp.mjs` from the Exhume repo
(github.com/tsang326/exhume) at commit `293d283f74992f354f43ae6ae636421a8b2c9df9` (abbreviated `293d283`; the file last changed in `c3d1d04`).

SHA-256: `56251a47fb008c9abe0cc0b1c1db1f08a1bf4c88cf2b05b6bb73f1cffe83451e`

Never edit it here. To update: rebuild in the Exhume repo (`npm run build:mcp`), copy the file, update the commit
and hash above and in the hash test, and note the change in `docs/KIRO_LOG.md`.
Tools: `open_disk`, `read_grave`, `exhume`, `explain_state`. Default mode is confined to `--root <dir>` and writes
only into `<root>/exhumed/`. This app never uses `--workspace-from-agent`.
