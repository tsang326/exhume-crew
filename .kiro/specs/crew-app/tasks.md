# Implementation Plan: crew-app (Exhume Crew)

## Overview

Build the Exhume Crew app bottom-up: tooling and the pin check, then the shared modules (sanitisers, path guard, Store), then the backend layers (HMAC, parameter guard, library, Exhume client, scanner, exports, routes), then the catalogue MCP server and launcher, the UI, the manifest with agents and skill, the demo golden file, the build and reproducibility check, and the documentation. Every task builds on earlier ones and nothing is left unwired. The language is TypeScript (strict, no `any`, Node 22+); the launcher `mcp/launch.py` is the only Python file and uses only the standard library.

Standing constraints for every task:

- The pinned bundle `mcp/exhume-mcp.mjs`, `mcp/PINNED.md` and the images in `demo-library/` already in the repo are used as-is and are never modified.
- Tests use Vitest and fast-check, live only in `src/**/*.test.ts` and `backend/**/*.test.ts` (UI DOM tests in `src/ui-dom/`), and the `exhumed/` folder is excluded from every test glob.
- A fast-check property callback returns nothing or a boolean and never calls `expect`; every property test runs at least 100 cases; each property test is tagged `Feature: crew-app, Property N: <title>`.
- Any test driver that mutates, stresses or spawns processes uses counted loops with hard iteration caps (no `while (true)` or unbounded loops) and `spawnSync` with an explicit `timeout` and `killSignal`.
- The default Library path is `~/Exhume Library`. The root `package.json` has no runtime dependencies.
- All property tests below are required. The design's property list is followed as numbered in `design.md`.

## Tasks

- [x] 1. Repository scaffold and pinned-bundle check
  - [x] 1.1 Create the tooling scaffold
    - Create root `package.json` with no `dependencies`, and `devDependencies` pinned to exact versions: `typescript`, `vitest`, `fast-check`, `esbuild`, `happy-dom`, `csv-parse`, `react`, `react-dom`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint`, `@typescript-eslint/*`; scripts `build`, `test` (`vitest --run`), `lint`, `typecheck`
    - Create `tsconfig.json` (strict, no implicit any), an ESLint config that errors on `@typescript-eslint/no-explicit-any`, and `vitest.config.ts` that includes only `src/**/*.test.ts` and `backend/**/*.test.ts` and excludes `**/exhumed/**` and `**/node_modules/**`
    - Create the empty directory layout from the design (`backend/src`, `src/shared`, `src/catalogue-mcp`, `src/ui-dom`, `ui/src`, `scripts`, `assets`, `agents`, `skills/floppy-archive`) and confirm `.gitignore` does not exclude `.kiro/` and does ignore `**/exhumed/`
    - _Requirements: 19.1, 19.13, 20.1, 20.4, 21.6_

  - [x] 1.2 Implement the pin-record parser and the pinned-hash test
    - Create `src/shared/pin.ts` with `parsePinRecord(text)` and `checkPinnedFile(bytes, record)`; the record is valid only with a `SHA-256:` value of exactly 64 lower-case hex characters and a commit hash; a mismatch error names both the expected and the actual hash
    - Create `src/shared/pin.test.ts` that reads the real `mcp/PINNED.md` and `mcp/exhume-mcp.mjs` and fails with a non-zero exit when the hash differs or the record is invalid
    - Do not edit `mcp/PINNED.md`. It records the full 40-character commit `293d283f74992f354f43ae6ae636421a8b2c9df9` (owner updated it); the parser requires exactly 40 lower-case hex characters for the commit
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 19.8_

  - [x] 1.3 Write property test for the pin-record parser
    - **Property 5: Pin record parsing**
    - **Validates: Requirements 2.3, 2.4**

  - [x] 1.4 Write the no-runtime-dependencies test
    - Create `src/shared/package-json.test.ts`: fail unless `dependencies` is absent or empty and every `devDependencies` version is an exact version (no `^`, `~`, `*`, `latest`, ranges)
    - _Requirements: 19.15, 20.4_

- [x] 2. Shared modules: sanitisers, path guard, schema, Store
  - [x] 2.1 Implement the sanitisers
    - Create `src/shared/sanitize.ts`: `sanitizeAgentText` (well-formed, removes C0, DEL, C1, U+2028, U+2029, U+202A to U+202E, U+2066 to U+2069, U+FEFF; idempotent), `cellText` (CSV control-character removal and the single-quote prefix for `=`, `+`, `-`, `@`, tab, CR), `displayName` for relative paths and labels, and `sanitizeFileName` (letters, digits, `.`, `-`, `_`; at most 255 characters; fixed fallback name when empty)
    - _Requirements: 8.4, 8.6, 9.6, 9.8, 15.7, 15.8, 16.5_

  - [x] 2.2 Write property test for agent text sanitising
    - **Property 25: Agent text sanitising**
    - **Validates: Requirements 9.6, 9.8, 16.5**

  - [x] 2.3 Implement the path guard and version guard
    - Create `src/shared/paths.ts` with `isWithin(base, candidate)` (segment-based, on realpaths, symlink aware) and a guarded-write helper that returns the "outside the permitted write locations" error
    - Create `src/shared/version.ts` with `checkNodeVersion(versionString)` (major at least 22, message names the minimum)
    - _Requirements: 4.6, 4.7, 20.1, 20.7_

  - [x] 2.4 Write property test for the write-target guard
    - **Property 21: Write-target guard**
    - Use a counted number of temporary directories and symlinks per case, cleaned up after each run
    - **Validates: Requirements 4.6, 4.7**

  - [x] 2.5 Write property test for the Node version guard
    - **Property 34: Node version guard**
    - **Validates: Requirements 20.7**

  - [x] 2.6 Define the data model and validators
    - Create `src/shared/schema.ts` with `DiskCard`, `FileEntry`, `FilesDoc`, `Summary`, `Note`, `Annotation`, `CatalogueData`, `ScanStatus`, `DiskCardView`, caps (warnings 100, notes 100, summary 1200, note 500, relPath 4096, label 255) and hand-written type guards on `unknown` (no `any`)
    - _Requirements: 5.5, 5.9, 6.1, 9.6, 9.8_

  - [x] 2.7 Implement the Store
    - Create `src/shared/store.ts`: `read`, `update`, `readFiles`, `writeFiles` under a `mkdir` lock (25 ms retry, 5 s limit giving `STORE_BUSY`, stale-lock recovery), temp file + `fsync` + atomic `rename`, temp file removal on failure (`STORE_WRITE_FAILED`), validation on read, corrupt file preserved as `catalogue.json.corrupt-<UTC>` with `STORE_CORRUPT` then an empty catalogue, `toWellFormed()` on strings before writing
    - Every retry and lock-wait loop has a hard iteration cap
    - _Requirements: 4.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 2.8 Write property test for the Store round trip
    - **Property 1: Store round trip**
    - **Validates: Requirements 6.1, 6.7, 19.9**

  - [x] 2.9 Write property test for failed Store writes
    - **Property 2: A failed write preserves the previous contents**
    - Inject failures with counted, capped loops over a fixed list of failure points
    - **Validates: Requirements 6.2, 6.6**

  - [x] 2.10 Write property test for serialised updates
    - **Property 3: Serialised updates keep every completed write**
    - Multi-instance interleaving uses a capped number of updates per case
    - **Validates: Requirements 6.4**

  - [x] 2.11 Write property test for corrupt catalogue handling
    - **Property 4: A corrupt catalogue is preserved and the Scanner can rebuild**
    - **Validates: Requirements 6.8**

  - [x] 2.12 Write the Store concurrent-writer integration test
    - Create `src/shared/store.concurrency.test.ts`: three child processes append through the Store at once and none is lost; a held lock gives `STORE_BUSY` after about 5 s
    - Constraint: counted loops with hard caps only; every child process is spawned with `spawnSync` and a `timeout` and `killSignal: "SIGKILL"`; no `while (true)`
    - _Requirements: 6.4, 6.5_

  - [x] 2.13 Write property test for download file name sanitising
    - **Property 31: Download file name sanitising**
    - **Validates: Requirements 15.7, 15.8**

- [x] 3. Checkpoint - shared modules
  - Run `vitest --run`, `tsc --noEmit` and the lint step. Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend security layer
  - [x] 4.1 Implement proxy signature verification
    - Create `backend/src/auth.ts`: `verifyProxyRequest({ headerValue, method, target, body, secret, now })` using HMAC-SHA256 over `<ts>:<METHOD>:<raw target incl. query>:<sha256(body)>`, 60 s freshness, digit-only timestamp of at most 12 digits, length check then `timingSafeEqual`, fails closed on a missing secret; helper that reads either header name `x-kirocrew-proxy` or `x-crew-proxy`
    - _Requirements: 7.2, 7.3, 19.14_

  - [x] 4.2 Write property test for signature verification
    - **Property 15: Proxy signature verification**
    - **Validates: Requirements 7.2, 7.3, 19.5**

  - [x] 4.3 Implement the parameter guard and error mapping
    - Create `backend/src/params.ts` (`guardParams`, `parseDiskId` with `/^[0-9a-f]{64}$/`, `parseEntryId` integer 0 to 4095; one decode, any remaining `%` is rejected; set-Library-path body exempt)
    - Create `backend/src/errors.ts` (`ApiError`, the fixed message table, `toErrorResponse`, `redactPaths` backstop; no `err.message`, stack or absolute path ever copied into a response)
    - _Requirements: 7.4, 7.6_

  - [x] 4.4 Write property test for the parameter guard
    - **Property 16: Parameter guard**
    - **Validates: Requirements 7.4, 19.6**

  - [x] 4.5 Write property test for error responses
    - **Property 18: Error responses contain no paths**
    - **Validates: Requirements 7.6**

- [x] 5. Library validation and demo copy
  - [x] 5.1 Implement the LibraryManager
    - Create `backend/src/library.ts`: `validateLibraryPath` (expand `~`, absolute path, `realpath` raced against a 2 s timer, directory check, reject `/`, the home directory and its ancestors by path segment, fixed error codes with no paths in messages), source order active file, then `config.json` `libraryPath`, then the default `~/Exhume Library`, `setLibrary` that writes `data/library-active.json` atomically only after validation, restarts the Exhume client hook and triggers a scan, `getStatus`; a rejected path keeps the previous valid path
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.10, 3.11, 3.12, 3.13, 7.14, 7.15_

  - [x] 5.2 Write property test for library path classification
    - **Property 7: Library path classification**
    - **Validates: Requirements 3.5, 3.6, 3.11, 7.15**

  - [x] 5.3 Implement the demo library copy
    - Create `backend/src/demo.ts`: copy `demo-library/*.img` into the Library via temp file then `fs.link` (never overwrites), remove temp files on any error, create the Library folder first when only its parent exists, report copied and skipped file names only, started only by a user action
    - _Requirements: 3.2, 3.3, 4.2, 7.13_

  - [x] 5.4 Write property test for the demo copy
    - **Property 8: Demo copy never overwrites and leaves no partial file**
    - Failure injection uses a counted loop over a fixed list of failure points
    - **Validates: Requirements 3.2, 3.3, 7.13**

- [x] 6. Exhume client
  - [x] 6.1 Implement the stdio JSON-RPC client for the pinned server
    - Create `backend/src/exhume-client.ts`: spawn `process.execPath` with `[mcp/exhume-mcp.mjs, "--root", <libraryRoot>]` (`shell: false`, minimal env, never `--workspace-from-agent`), handshake, one JSON object per line, 1 MiB line cap, serialised request queue, per-call timeouts (`open_disk` 30 s, `read_grave` 10 s, `exhume` 30 s) that kill the child, lazy restart, hand-written type guards on results, `EXHUME_UNAVAILABLE` and `EXHUME_TIMEOUT`, no fallback parser; export the line reader so it can be tested alone
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 6.2 Write property test for JSON-RPC line framing
    - **Property 6: JSON-RPC line framing round trip**
    - **Validates: Requirements 2.5**

  - [x] 6.3 Write the Exhume client integration tests
    - Create a small stub server script in `backend/test-fixtures/` that speaks the same line protocol and can be told to answer, error, hang or exit; test handshake, tool errors, timeout kill and restart, process exit, and one run against the real pinned server and `demo-library/`
    - Constraint: counted loops with hard caps only; processes are driven with `spawnSync` (or a child with a hard timer) with an explicit `timeout` and `killSignal: "SIGKILL"`; no `while (true)`
    - _Requirements: 2.5, 2.7, 2.8, 5.7, 5.8_

- [x] 7. Scanner
  - [x] 7.1 Implement discovery and classification
    - Create `backend/src/scanner.ts` (walk and classify part): iterative walk with depth cap 8 and entry cap 10,000, skip the top-level `exhumed/` folder, ignore `.DS_Store`, `Thumbs.db`, `desktop.ini` and `._*`, warn for control-character names, symlinks (never followed), empty, too large, size not a multiple of 512 or wrong extension (`.img .ima .dsk .flp .vfd`), warnings carry the relative path only; open candidates with `O_RDONLY | O_NOFOLLOW`, `fstat` check, `realpath` inside the Library_Root, SHA-256; a failed read-only open is a warning and no other mode is tried
    - _Requirements: 3.7, 3.8, 3.9, 4.1, 4.8, 5.6_

  - [x] 7.2 Implement card derivation and status rules
    - Create `src/shared/card.ts`: derive a Disk_Card from an `open_disk` report (label, geometry label from byte size, `fileCount`, `totalEntries`, truncation flag, date range, counts, warning cap), merge `read_grave` formats, status rules `new`, `catalogued`, `summarised`, and the `DiskCardView` merge of card, summary and notes
    - _Requirements: 5.5, 5.9_

  - [x] 7.3 Implement scan orchestration, status and watcher
    - Extend `backend/src/scanner.ts`: per-image flow (unchanged skip, placeholder card, `open_disk`, up to 64 `read_grave` calls within the 30 s per-disk budget, `files/<id>.json` then card in one locked update), warning cards on failure or timeout, client restart after an exit, first-seen kept on change, prune vanished paths, in-memory `ScanStatus`, one scan at a time, `fs.watch` recursive with a 2 s debounce ignoring `exhumed`, 15 s polling fallback with a capped loop, no model calls and no cron state
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10, 17.4_

  - [x] 7.4 Write property test for discovery plus the hostile-entry stress test
    - **Property 9: Discovery classifies every entry and never throws**
    - Add a hostile-library stress test (symlinks, oversize file, non-image, image resolving outside, control-character names, junk inside `exhumed/`) that checks the scan completes, warns for each hostile entry and still returns cards for all valid images
    - Constraint: counted loops with hard caps only; any spawned process uses `spawnSync` with `timeout` and `killSignal`; no `while (true)`
    - **Validates: Requirements 3.7, 3.8, 3.9, 18.5, 19.4**

  - [x] 7.5 Write property test for read-only behaviour
    - **Property 10: Scans and exhume-all leave the library unchanged**
    - Compare bytes, size and mtime of every image and the set of created paths (only inside `exhumed/`) before and after a capped sequence of operations
    - **Validates: Requirements 4.1, 4.2, 5.10**

  - [x] 7.6 Write property test for rescan idempotence and change detection
    - **Property 11: Rescan idempotence and change detection**
    - **Validates: Requirements 5.3, 5.4, 19.3**

  - [x] 7.7 Write property test for card derivation
    - **Property 12: Card derivation matches the report**
    - **Validates: Requirements 5.5**

  - [x] 7.8 Write property test for status derivation
    - **Property 13: Status derivation**
    - **Validates: Requirements 5.9**

  - [x] 7.9 Write property test for Exhume failure isolation during a scan
    - **Property 14: Exhume failures during a scan are isolated**
    - Use the in-memory fake client with scripted outcomes (success, tool error, timeout, process exit)
    - **Validates: Requirements 2.8, 5.7, 5.8**

- [x] 8. Exports
  - [x] 8.1 Implement CSV and Markdown export
    - Create `src/shared/csv.ts` (fixed ordered columns, RFC 4180 quoting, `\r\n` rows, `cellText`) and `backend/src/exports.ts` (`toCsv`, `toMarkdown` with escaped Markdown punctuation, whole string built before sending, `EXPORT_FAILED` with no partial body)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8_

  - [x] 8.2 Write property test for the CSV round trip
    - **Property 22: CSV round trip**
    - Use `csv-parse` as the independent parser; up to 10,000 cards in the largest cases
    - **Validates: Requirements 8.1, 8.3, 8.5, 8.7, 19.10**

  - [x] 8.3 Write property test for CSV cell sanitising
    - **Property 23: CSV cell sanitising**
    - **Validates: Requirements 8.4, 8.6**

  - [x] 8.4 Write property test for the Markdown export
    - **Property 24: Markdown export structure**
    - **Validates: Requirements 8.2, 8.6, 8.7**

- [x] 9. Page API server and routes
  - [x] 9.1 Implement the HTTP server, routes and entry point
    - Create `backend/src/server.ts` (`node:http` on `127.0.0.1:PORT`; order: header present, body capped at 64 KiB, HMAC, param guard, handler; `/health` returns `{"ok":true}` unsigned; `nosniff` and `no-store` headers), `backend/src/routes.ts` with exactly the 11 operations in the design (library get and put, use demo library, scan status, rescan, list disks, one disk with files, preview by entry id with 65,536-byte truncation and PNG facts plus `imageDataUrl` only for earlier exhumed entries read from `exhumed/` read-only up to 1.5 MB, exhume-all with `DISK_CHANGED` check, CSV and Markdown export), and `backend/src/main.ts` (Node version guard as an esbuild banner, secret and port from env, wiring of Store, LibraryManager, ExhumeClient, Scanner, watcher, graceful shutdown)
    - _Requirements: 1.4, 2.7, 3.11, 4.3, 5.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 20.7_

  - [x] 9.2 Write route tests
    - Create `backend/src/routes.test.ts`: the route table has exactly the operations of Requirement 7.1; `/health` answers 200 `{"ok":true}` without a signature; both header names `X-KiroCrew-Proxy` and `X-Crew-Proxy` are accepted; every Page_API route answers 401 without a valid signature and performs no action; preview failure gives 502 or 504 with no partial content; PNG preview facts and data URL rules; scan status and library status shapes; set-library-path validation and 400 behaviour; use-demo-library; rescan while running
    - _Requirements: 7.1, 7.2, 7.8, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 19.14_

  - [x] 9.3 Write property test for unknown Disk_Id
    - **Property 17: Unknown Disk_Id gives 404 without calling Exhume**
    - **Validates: Requirements 7.5**

  - [x] 9.4 Write property test for preview truncation
    - **Property 19: Preview truncation**
    - **Validates: Requirements 7.7**

  - [x] 9.5 Write property test for exhume-all
    - **Property 20: Exhume-all selects exactly the Recoverable_Entries and isolates failures**
    - **Validates: Requirements 7.9, 7.10**

- [x] 10. Checkpoint - backend
  - Run `vitest --run`, `tsc --noEmit` and lint. Ensure all tests pass, ask the user if questions arise.

- [x] 11. Catalogue MCP server and launcher
  - [x] 11.1 Implement the catalogue MCP server
    - Create `src/catalogue-mcp/jsonrpc.ts`, `tools.ts`, `main.ts`: hand-written JSON-RPC 2.0 over stdio (no SDK, one message per line, 1 MiB cap, same four protocol versions as the pinned server), exactly the tools `list_disks` (cap 200, ascending Disk_Id, `withoutSummary`, `after` cursor, 256 KB trim), `get_disk_card`, `save_disk_summary` (1 to 1200), `add_disk_note` (1 to 500, at most 100 notes), `agent` enum `exhume-archivist` or `exhume-undertaker` as provenance only, `untrusted: true` plus the same notice text as the pinned server, constant tool descriptions, fixed error messages that never echo input, Node version guard, all state through the Store with `--data-dir`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.14, 16.2, 16.5, 20.7_

  - [x] 11.2 Write in-process tool tests
    - Create `src/catalogue-mcp/tools.test.ts`: each tool succeeds, result-size caps are enforced, stripping is applied to returned content, an unknown Disk_Id returns `DISK_NOT_FOUND`
    - _Requirements: 9.3, 9.4, 9.5, 9.11, 19.7_

  - [x] 11.3 Write property test for summary and note bounds
    - **Property 26: Summary and note bounds and round trip**
    - **Validates: Requirements 9.6, 9.7, 9.8, 9.9, 9.13**

  - [x] 11.4 Write property test for `list_disks`
    - **Property 27: `list_disks` cap, order, size and filter**
    - **Validates: Requirements 9.3, 9.11, 17.3**

  - [x] 11.5 Write property test for rejected tool calls
    - **Property 28: Rejected tool calls leave the Store unchanged**
    - **Validates: Requirements 9.5, 9.10, 9.11**

  - [x] 11.6 Write property test for the untrusted envelope
    - **Property 29: Untrusted envelope on disk-derived output**
    - **Validates: Requirements 9.11, 16.2**

  - [x] 11.7 Implement the launcher
    - Create `mcp/launch.py` (standard library only; never imports `kiro_crew`): derive the app root from `realpath(__file__)`, find `node` (PATH, nvm newest, `/opt/homebrew/bin`, `/usr/local/bin`), require major version 22 or higher, `exhume` mode reads only `data/library-active.json` and execs `exhume-mcp.mjs --root <path>` when the path is an existing directory, `catalogue` mode execs `catalogue-mcp.mjs --data-dir <data>`, one stderr line and non-zero exit for no library, no `node`, old `node` or an unknown mode
    - _Requirements: 1.10, 1.11, 1.12, 1.13, 1.14_

  - [x] 11.8 Write launcher tests
    - Create `backend/src/launcher.test.ts`: the import lines of `mcp/launch.py` are all in a standard-library allow-list and none is `kiro_crew`; runs with a missing library file, an unknown mode and a stripped `PATH` each give one stderr line and a non-zero exit
    - Constraint: counted loops with hard caps only; every run uses `spawnSync` with an explicit `timeout` and `killSignal: "SIGKILL"`; no `while (true)`
    - _Requirements: 1.10, 1.12, 1.13, 1.14_

- [x] 12. UI
  - [x] 12.1 Implement UI foundations
    - Create `ui/src/host.d.ts` (local types for the `@kirocrew/app-sdk` hooks used, no `any`), a typed API wrapper over `useAppApi()` with base `/apps/exhume-crew/api`, the chat message builders (`buildSummariseMessage(ids)`, `buildUndertakerMessage(id)`, each id validated against `/^[0-9a-f]{64}$/`), and the download helper (Blob with fixed MIME from `text/csv`, `text/markdown`, `application/octet-stream`, name through `sanitizeFileName`)
    - _Requirements: 13.5, 14.8, 15.2, 15.7, 15.8, 16.4_

  - [x] 12.2 Write property test for chat messages
    - **Property 30: Chat messages contain only fixed text and Disk_Ids**
    - **Validates: Requirements 13.5, 13.6, 14.8, 15.2, 16.4**

  - [x] 12.3 Implement the Markdown and CSV preview parsers
    - Create `ui/src/lib/markdown.ts` (own block and inline parser producing a tree of heading, paragraph, list, list item, emphasis, strong, code and text only; link syntax shown as literal text; no images or raw HTML) and `ui/src/lib/csv.ts` (own parser, caps 1,000 rows and 50 columns)
    - _Requirements: 14.3, 14.4, 15.9_

  - [x] 12.4 Write property test for the Markdown preview
    - **Property 33: Markdown preview builds no HTML**
    - **Validates: Requirements 14.3, 15.9**

  - [x] 12.5 Implement the single page and its views
    - Create `ui/src/index.tsx` (default export `ExhumeCrewApp`, view state initialised from `window.location.search` `?id=` and updated with `history.replaceState`, switch within 500 ms), `LibraryView` with `SettingsArea`, `Toolbar` (Rescan, Export CSV, Export Markdown, "Summarise new disks"), `ScanProgress` (polled every 1 s), `EmptyState` with "Use demo library", shelf of disk cards (status, recovered, partial and lost counts, warnings, Summary, Notes, placeholders when empty), `DiskView` (graveyard of tombstones and open graves with Grade and reason, truncation notice, not-found state, `PreviewPane` for Markdown, CSV, PNG and text, "Exhume all recoverable" with the tooltip stating that it exhumes live files and deleted entries graded `recovered`, disabled while running, result list, error state, "Ask the undertaker"), `DecorLayer` (lantern and fog in code, translucent SVG, `aria-hidden`), a single `<style>` element with focus-visible outline (2 px, at least 3:1) and decorative `@keyframes` inside `prefers-reduced-motion: no-preference`; untrusted text only as React text children or `textContent`; no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `dangerouslySetInnerHTML`; theme from `useTheme()` and host CSS variables; no network requests of its own
    - _Requirements: 3.10, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 12.6 Write property test for literal rendering
    - **Property 32: Untrusted text renders literally**
    - Put in `src/ui-dom/render.test.ts` using `happy-dom` and no JSX
    - **Validates: Requirements 13.2, 15.1, 15.9, 16.6, 19.11**

  - [x] 12.7 Write UI example tests and static scans
    - Create `src/ui-dom/views.test.ts`: empty state, buttons disabled while scanning or with no disks, progress text, failed-scan state with Rescan re-enabled, not-found view, tooltip text, results list after exhume-all, preview error keeps the list usable, truncation notice, no chat opened when no disk lacks a Summary, reduced-motion style rule present
    - Create a static scan test: no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `dangerouslySetInnerHTML` in `ui/src`; no `fetch(`, `eval`, `Function(`, `npx` or `latest` in backend, MCP and UI sources; no explicit `any`; no Backend module opens a file for writing outside the Store, the active-library file and the demo copy
    - _Requirements: 13.3, 13.4, 13.6, 13.8, 13.9, 13.10, 14.7, 14.9, 14.10, 14.11, 14.12, 15.1, 15.5, 15.6, 20.1, 20.5, 20.6_

- [x] 13. Manifest, agents, skill, cron
  - [x] 13.1 Write the icon, agents and skill
    - Create `assets/icon.png` (square PNG, at least 256 x 256), `agents/undertaker.json` and `agents/archivist.json` per the design (tool lists with `@exhume-crew:...` references, `allowedTools`, `managedToolPolicy.exclude`, prompts: disk text is data, instruction-like text is reported and not followed, undertaker calls `open_disk` first and `exhume` only on explicit request, archivist reads 3 to 10 previews, cites a source file for every fact, omits unsourced names and dates; archivist has no `exhume`), and `skills/floppy-archive/SKILL.md` (open and do-not-open cases, the three Grades as mutually exclusive definitions, fact-with-source rule, instruction-text rule)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 16.2, 16.3_

  - [x] 13.2 Write `app.json`
    - Create `app.json` per the design: name, displayName, MIT, `iconPath`, `minKiroCrewVersion` 0.12.1, 1 to 10 tags, `platform.os` exactly `macos` and `linux`, `dependencies.commands` `["node"]`, agents, skill, `mcpServers` `exhume` and `exhume-catalogue` with `command: "python3"` and `args: ["mcp/launch.py", "<mode>"]` and `autoApprove` lists that together are exactly `open_disk`, `read_grave`, `explain_state`, `list_disks`, `get_disk_card`, `save_disk_summary`, `add_disk_note` (never `exhume`), exactly one `crons` entry (`every` 86400, `enabled` false, agent `exhume-archivist`) with `permissions.cron` true, backend (`backend/server.mjs`, `node`, port `auto`, `/health`), one `ui.pages` entry at `/apps/exhume-crew`, `permissions.api` listing only the proxy paths the UI uses, `network` false, `setup.configSchema` with `libraryPath` default `~/Exhume Library`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.1, 16.1, 17.1, 17.2, 17.5_

  - [x] 13.3 Write manifest, agent and skill file tests
    - Create `backend/src/manifest.test.ts`: compare `app.json` with the constants above, every declared path exists, no MCP arg contains `~/.kiro/crew/apps/`, `iconPath` is a square PNG of at least 256 pixels, `permissions.api` equals the paths used by the UI wrapper and the route table, `exhume` is in no auto-approve list; the undertaker and archivist `tools` lists equal the expected constants, the archivist has no `exhume`, both agents list `floppy-archive`, key prompt phrases are present, `SKILL.md` contains the three Grade definitions, a positive and a negative trigger, the fact-with-source rule and the instruction-text rule
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 10.1, 10.9, 11.1, 11.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 16.1, 17.1, 17.2_

- [x] 14. Demo library golden
  - [x] 14.1 Generate the golden JSON and write the demo scan test
    - Create `backend/test-fixtures/demo-golden.json` from a scan of the existing `demo-library/` with the real pinned server (excluding scan times and absolute paths), and `backend/src/demo-scan.test.ts` that checks exactly four cards equal to the golden file, the scan finishes within 10 s with no network, one unreadable or missing image still leaves cards for the others, and the SHA-256 of `fd13-720k-dsk01.img` equals the hash recorded in `demo-library/NOTICE.md`
    - Do not modify the images or `NOTICE.md`. Constraint: counted loops with hard caps only; any spawned process uses `spawnSync` with `timeout` and `killSignal`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 19.2_

- [x] 15. Build and reproducibility
  - [x] 15.1 Implement the build and the reproducibility check
    - Create `scripts/build.mjs` (esbuild) producing `backend/server.mjs` (with the Node version guard banner), `mcp/catalogue-mcp.mjs` and `ui/dist/index.mjs` (externals `react`, `react-dom`, `react/jsx-runtime`, `@kirocrew/app-sdk`, `lucide-react`); commit the built files; add `scripts/check-build.mjs` (or a test) that runs the build and then `git diff --exit-code` over the three outputs
    - Constraint: the check spawns the build with `spawnSync` and an explicit `timeout` and `killSignal`; no unbounded loops
    - _Requirements: 1.2, 20.2, 20.3, 20.4_

- [x] 16. Documentation
  - [x] 16.1 Write the README
    - Create `README.md` with distinct sections: what the app does, install steps in order, "Verified Crew behaviours" and "Assumptions" listed exactly as in `design.md` (V1 to V23 as verified from docs or built-in apps with dates and method; A1 to A14 as Assumed), a "Manual install check" section marked pending, the statement on how MCP args reference app files (relative `.py` launcher with `python3`, source `bridges_mcp.py` and `env.py`, stdlib-only launcher) , how to enable and disable the cron and that it spends model credits, accepted residual risks (including the owner's wording that a hostile disk can at worst make an agent read other disks in the library or write misleading capped text into a Summary or Note, and cannot write files, reach the network or leave the library; v1 signature replay window), credits to the Exhume repo and andete/disk-peek, and a note that nothing is moved to "Verified by hand" until the owner's final task
    - _Requirements: 1.9, 17.6, 21.1, 21.2, 21.3, 21.4, 21.5, 21.9, 21.10_

  - [x] 16.2 Write `docs/KIRO_LOG.md`
    - Create `docs/KIRO_LOG.md` with two sections, "Generated by Kiro" and "Fixed by hand", each with at least one entry or the text "None"
    - _Requirements: 21.7_

- [x] 17. Final checkpoint - automated checks
  - Run `vitest --run`, `tsc --noEmit`, lint and the build reproducibility check for `backend/server.mjs`, `mcp/catalogue-mcp.mjs` and `ui/dist/`; confirm the pinned-hash test and the no-runtime-dependencies test pass and that no test file under `exhumed/` is discovered. Ensure all tests pass, ask the user if questions arise.

- [~] 18. MANUAL CHECKS FOR THE OWNER - the coding agent must NOT execute this task and must NOT mark it complete
  - This task is performed by the repository owner by hand in an installed Kiro Crew 0.12.1. The agent must not run it, simulate it, or tick the checkbox.
  - Install from the local folder, enable, and confirm Crew lists the page, both agents, the `floppy-archive` skill and both MCP servers (`exhume`, `exhume-catalogue`); record the result and date in the README "Manual install check" section
  - Run the by-hand checks for assumptions A1 to A14 from `design.md` (per-tool mounts, `autoApprove` and `exhume` prompting, launcher path anchoring, `node` discovery under a stripped environment, query-string navigation, `raw()` downloads, `openChat` agent resolution, cron agent name, sandbox access to the library and `fs.watch`, `.app_secret` creation, `configSchema` form, host styling classes, `replaceState`, data kept across update)
  - With the demo library: open a disk, ask the undertaker for a file and then to exhume it (approval prompt only for `exhume`), let the archivist summarise one disk and check the Summary cites file names, check an instruction-bearing file is reported and not followed, keyboard-only pass, focus ring contrast in light and dark mode, reduced-motion on, enable the cron once and confirm it runs without prompts
  - Record in one commit: for each behaviour that passed, move it from "Assumed" to "Verified by hand" in the README with the date and method, and move the same item from Assumptions to Verified in `design.md` (Requirement 21.9); leave failed items under "Assumed" with a note
  - _Requirements: 1.8, 1.9, 21.2, 21.3, 21.5, 21.8, 21.9_

- [x] 19. Post-install fixes (owner feedback after the Crew 0.12.1 demo run; do not commit)
  - [x] 19.1 Fix the UI: grave row click target, stale library error, Exhume look
    - Edit only `ui/src/**` and UI tests in `src/ui-dom/**`
    - Disk view: make the whole grave row the click target (the button fills the row, keyboard focus unchanged, still a real button with the focus-visible outline)
    - Library view: clear the library error whenever a later library status is valid, and after a successful Use demo library or set path
    - Look: live files as tombstones, deleted entries as open graves with the grade shown on the grave, lantern and fog, translucent, drawn in code (inline SVG/CSS, no image files), lighter than the Exhume web page, readable in light and dark, animations only inside `prefers-reduced-motion: no-preference`; shelf cards feel like disks on a shelf
    - Keep every security rule: React text children only, exactly one style element, no network, no innerHTML-family APIs, no `any`, decorative layers `aria-hidden`
    - Add tests for the whole-row click and the cleared error
    - _Requirements: 3.10, 13.1-13.10, 14.1-14.13, 15.1-15.7_

  - [x] 19.2 Fix prompts, skill, sanitiser and README
    - Undertaker prompt (and skill if needed): report the exhumed path exactly as the `exhume` tool returns it, described as inside the library's `exhumed` folder; never prefix the session workspace or any other folder
    - Archivist prompt and skill: keep live files ("readable") separate from the three grades of deleted entries (recovered / partial / lost); never call a live file "recovered"
    - `sanitizeAgentText` also strips U+200B, U+200C, U+200D and U+2060; update Property 25 and any affected tests
    - README: short note that Crew requires the owner to trust a third-party app before enabling it (CLI enable is refused by policy; the dashboard shows a trust prompt); move nothing to "Verified by hand"
    - Update manifest and agent file tests for the new prompt phrases
    - _Requirements: 9.6, 9.8, 10.1-10.10, 11.1-11.8, 12.1-12.6, 16.5, 21.2_

  - [x] 19.3 Rebuild and run all checks
    - Run `npm run build`, then `vitest --run`, `tsc --noEmit`, lint and `npm run check-build`; fix failures minimally without weakening tests; confirm `mcp/exhume-mcp.mjs` and `mcp/PINNED.md` are unchanged; do not commit; leave task 18 alone
    - _Requirements: 19.13, 20.2, 20.3, 20.4_

## Notes

- All property-based test sub-tasks are required. `docs/SPEC_BRIEFS.md` only says "Property tests where they fit (store round-trip, CSV export parses back)" and gives no permission to make any of them optional.
- Security properties P9, P10, P15, P16, P18, P21, P25, P29, P30, P31 and P32 are required in any case.
- Each task references specific requirements for traceability; checkpoints give incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "2.3", "2.6", "13.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "2.4", "2.5", "2.7", "2.13", "4.1", "4.3"] },
    { "id": 3, "tasks": ["2.8", "2.9", "2.10", "2.11", "2.12", "4.2", "4.4", "4.5", "5.1", "6.1", "8.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.2", "6.3", "7.1", "7.2", "8.2", "8.3", "8.4", "11.1", "11.7", "12.1", "12.3"] },
    { "id": 5, "tasks": ["5.4", "7.3", "7.7", "7.8", "11.2", "11.3", "11.4", "11.5", "11.6", "11.8", "12.2", "12.4", "12.5"] },
    { "id": 6, "tasks": ["7.4", "7.5", "7.6", "7.9", "9.1", "12.6", "12.7"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "9.5", "13.2", "15.1"] },
    { "id": 8, "tasks": ["13.3", "14.1"] },
    { "id": 9, "tasks": ["16.1", "16.2"] },
    { "id": 10, "tasks": ["19.1", "19.2"] },
    { "id": 11, "tasks": ["19.3"] }
  ]
}
```
