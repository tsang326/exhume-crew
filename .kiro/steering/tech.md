---
inclusion: always
---
# Tech rules

- TypeScript, strict, no `any`. Node 22+. Follow the Kiro Crew app docs (kiro.dev/docs/crew/apps, manifest, sdk)
  and the skeleton from `kirocrew app init`; when the docs and a built-in app disagree, record which one you followed.
- Layout: `app.json`; `mcp/exhume-mcp.mjs` (pinned, never edited, see `mcp/PINNED.md`); `src/catalogue-mcp/` built
  into the committed `mcp/catalogue-mcp.mjs`; `backend/`; `ui/` with the committed bundle in `ui/dist/`;
  `agents/`; `skills/`; `demo-library/`.
- Disk parsing happens only in the pinned Exhume server (spoken to over stdio JSON-RPC, one message per line).
  No second copy of the FAT12 reader or the converters.
- One store module for catalogue state (cards, summaries, notes) in the app data dir, shared by the backend and the
  catalogue MCP server; atomic writes.
- Runtime dependencies: as few as possible, each with a reason in the commit message. The catalogue MCP server is
  hand-written JSON-RPC like Exhume's, no SDK.
- Tests: Vitest + fast-check in `src/**/*.test.ts` / `backend/**/*.test.ts`. A fast-check property callback returns
  nothing or a boolean, never `expect(...)`. Mutation/stress drivers use counted loops and spawnSync timeouts.
- No secrets, no analytics, no network.
