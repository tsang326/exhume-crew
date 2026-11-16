# Pinned Exhume MCP server

`exhume-mcp.mjs` is a byte-for-byte copy of `power/server/exhume-mcp.mjs` from the Exhume repo
(github.com/tsang326/exhume) at commit `47c388af66cdb82c961ed0df6d4790def836fafd` (abbreviated `47c388a`; the file last changed in `47c388a`).

SHA-256: `010751db0db7dbd02221e0b4a9a20faae824d75f63c337d0dad3617cf1a2098b`

Never edit it here. To update: rebuild in the Exhume repo (`npm run build:mcp`), copy the file, update the commit
and hash above and in the hash test, and note the change in `docs/KIRO_LOG.md`.
Tools: `open_disk`, `read_grave`, `exhume`, `explain_state`. Default mode is confined to `--root <dir>` and writes
only into `<root>/exhumed/`. This app never uses `--workspace-from-agent`.
