# Requirements Document

## Introduction

Exhume Crew is a Kiro Crew app for people with a box of old floppy disks. The user points the app at a library folder of disk images. A backend catalogues every image without any model call, using a pinned copy of the Exhume MCP server. Two agents do the work that needs judgement: the undertaker answers questions and exhumes files on request, and the archivist writes a short factual finding aid per disk. One Crew page presents two views: the Library view (the shelf) and the Disk view (the graveyard), the second addressed by an `?id=` query on the same route. An optional daily job, disabled by default, asks the archivist to summarise disks that have no summary. An app-contributed MCP server, `exhume-catalogue`, gives the agents access to the catalogue. Both MCP servers are started through a small stdlib-only Python launcher, because Crew gives MCP server arguments no variable for the installed app folder.

This spec covers the whole Crew app (Spec 1 in `docs/SPEC_BRIEFS.md`). It follows the steering files in `.kiro/steering` (`product.md`, `tech.md`, `safety.md`). Where Crew's installed build and its documentation disagree, the installed build is followed and `design.md` records the choice. Disk images are untrusted bytes from a stranger.

Decisions recorded with this version: (a) the default Library path is `~/Exhume Library`, not a folder under `~/Documents`, because macOS privacy protection (TCC) guards `~/Documents` and a sandboxed backend may get a prompt or a silent failure there, while a plain folder in the home directory avoids it; the home directory itself stays rejected as a Library. (b) The "Use demo library" copy is the one user-initiated write into the Library outside the Exhumed_Dir. (c) The Backend is shipped as a committed built file, so installation needs no build step.

Out of scope: publishing to the Crew store or any registry, cloud or remote instances, editing images, writing outside `<library>/exhumed/` and the app data dir, network access, and changes to the `exhume` repo.

### Carry-forward instruction for the design phase

Before writing `design.md`, the author MUST read the Kiro Crew app docs (kiro.dev/docs/crew/apps, /manifest, /sdk) and one or two built-in apps in `/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend/lib/python3.12/site-packages/kiro_crew/apps/builtins/` (read only). `design.md` MUST list which Crew behaviours were verified and which are assumptions. When the docs and a built-in app disagree, `design.md` records which one was followed.

## Glossary

- **Exhume_Crew**: The Kiro Crew app specified here, named `exhume-crew`.
- **Library**: The user-chosen folder of disk images.
- **Library_Root**: The realpath of the Library.
- **Disk_Image**: A regular file inside the Library_Root that holds a floppy image of at most 2.88 MB.
- **Disk_Id**: The sha256 of a Disk_Image, used as its identifier.
- **Exhume_Server**: The pinned MCP bundle `mcp/exhume-mcp.mjs`, copied byte for byte from the committed bundle in the `exhume` repo at commit 293d283f74992f354f43ae6ae636421a8b2c9df9 (abbreviated 293d283). Its tools are `open_disk`, `read_grave`, `exhume` and `explain_state`. The Exhume_Server labels the disk-derived text it returns as untrusted content from the disk.
- **Pin_Record**: The file `mcp/PINNED.md` with source repo, full commit hash, sha256 of the committed bundle file at that commit, and update procedure.
- **Backend**: The Node process declared with `backend.type: "node"`, started from the committed built file `backend/server.mjs`, that scans, stores and serves the Page_API.
- **Launcher**: The file `mcp/launch.py`, a stdlib-only Python script that locates `node` and starts the Exhume_Server or the Catalogue_Server.
- **Active_Library_File**: The file in the App_Data_Dir in which the Backend records the Library path after it has validated it; the Launcher reads only this file to choose the Exhume_Server root.
- **Library_Config_File**: The file `config.json` in the App_Data_Dir, which Crew may write from `setup.configSchema` values.
- **Scanner**: The Backend component that finds Disk_Images and calls the Exhume_Server.
- **Store**: The single store module for catalogue state (cards, summaries, notes) in the app data dir, shared by the Backend and the Catalogue_Server.
- **App_Data_Dir**: The directory returned by `getAppDataDir()`.
- **Disk_Card**: The stored record for one Disk_Image: label, size, Geometry, file count, total entry count, an entry-list-truncated flag, date range, Formats_Found, counts of recovered, partial and lost entries, warnings, Disk_Id and first-seen time.
- **Geometry**: A pair of a source (`bpb`, `fallback` or `none`, as reported by the Exhume_Server in `open_disk`) and a size label derived only from the Disk_Image size in bytes (`360K`, `720K`, `1.2M`, `1.44M`, `2.88M`, or empty when the size matches none of them).
- **Formats_Found**: The set of converter output families (`markdown`, `csv`, `png`, `text`) returned by `read_grave` for up to 64 readable non-directory entries of one Disk_Image during its scan.
- **Card_Status**: One of `new`, `catalogued` or `summarised`.
- **Grade**: The state of a deleted entry: `recovered`, `partial` or `lost`, with a reason. Live files have no Grade.
- **Page_API**: The HTTP routes under `/apps/exhume-crew/api/*` (served by the Backend as `/api/*`), listed in Requirement 7.
- **Health_Route**: The Backend route `/health`, outside the Page_API, used by the Gateway health check.
- **Settings_Area**: The small settings area on the Library_Page that shows the current Library path and its errors and offers "Use demo library".
- **Auto_Approve_List**: The set of tools that `app.json` marks as auto-approved (field `autoApprove`) in `mcpServers`: `open_disk`, `read_grave`, `explain_state`, `list_disks`, `get_disk_card`, `save_disk_summary` and `add_disk_note`. The `exhume` tool is never in it.
- **Recoverable_Entry**: A live file, or a deleted entry whose Grade is `recovered`.
- **Gateway**: The Crew gateway that proxies requests to the Backend.
- **Proxy_Signature**: The HMAC that the Gateway adds in the header `X-KiroCrew-Proxy` (sent by the installed Crew build) or `X-Crew-Proxy` (named in the Crew documentation); the Backend accepts both names with the same value format.
- **Agent_Name**: One of the two values `exhume-archivist` and `exhume-undertaker`, passed as the `agent` argument of `save_disk_summary` and `add_disk_note` for provenance only.
- **Catalogue_Server**: The app's own MCP server `exhume-catalogue`, built from `src/catalogue-mcp/` into `mcp/catalogue-mcp.mjs`.
- **Undertaker**: The agent defined in `agents/undertaker.json` (Agent_Name `exhume-undertaker`).
- **Archivist**: The agent defined in `agents/archivist.json` (Agent_Name `exhume-archivist`).
- **Floppy_Skill**: The skill in `skills/floppy-archive/SKILL.md`.
- **Crew_Page**: The single UI page of the app, at the route `/apps/exhume-crew`, declared as the only entry of `ui.pages` and shown in the sidebar.
- **Library_Page**: The view of the Crew_Page that shows the shelf of Disk_Cards, shown when the URL has no `id` query.
- **Disk_Page**: The view of the Crew_Page that shows one disk's graveyard, addressed as `/apps/exhume-crew?id=<Disk_Id>`; it is not a separate route.
- **Demo_Copy**: The copy of the Demo_Library disk images into the Library under Requirement 3 criterion 2.
- **Summary**: Plain-text agent output describing a disk, at most 1200 characters.
- **Note**: Plain-text provenance text attached to a disk by the Undertaker or Archivist.
- **Untrusted_Text**: File names, previews, labels, Summaries, Notes and any other text derived from a Disk_Image or an agent.
- **Hostile_Entry**: A Library item that is a symlink, larger than 2.88 MB, not a disk image, resolving outside the Library_Root, or named with control characters.
- **Exhumed_Dir**: The folder `<Library_Root>/exhumed/`, including its subdirectories.
- **Demo_Library**: The `demo-library/` folder in the app folder with three Exhume demo disks and one FreeDOS 1.3 image with its notice.

## Requirements

### Requirement 1: App package and manifest

**User Story:** As a judge, I want to install the app from a local folder, so that I can see a full shelf in one click.

#### Acceptance Criteria

1. THE Exhume_Crew SHALL provide an `app.json` with name `exhume-crew`, displayName "Exhume Crew", license MIT, an `iconPath` that resolves to an existing image file inside the app folder, at least 1 and at most 10 tags, `platform.os` of exactly `macos` and `linux`, and `minKiroCrewVersion` set to 0.12.1.
2. THE Exhume_Crew SHALL provide the built Backend file `backend/server.mjs`, `ui/` with a committed ESM bundle in `ui/dist/`, `agents/undertaker.json`, `agents/archivist.json`, `skills/floppy-archive/SKILL.md`, `mcp/` (containing `exhume-mcp.mjs`, `catalogue-mcp.mjs`, `launch.py` and `PINNED.md`) and `demo-library/`, so that every one of these paths exists in the app folder without running a build step.
3. THE `app.json` SHALL declare exactly one `ui.pages` entry, the Crew_Page at the route `/apps/exhume-crew` shown in the sidebar, the 2 agents (`undertaker`, `archivist`), the `floppy-archive` skill, the Backend with `backend.entryPoint` `backend/server.mjs`, `backend.type` `node`, port `auto` and the Health_Route as health check, and exactly one `crons` entry together with `permissions.cron` set to true.
4. THE `app.json` SHALL list in `permissions.api` only the Page_API paths that the pages and the Backend use, and every Page_API path called by the pages or the Backend SHALL appear in that list.
5. THE `app.json` SHALL set `network` to `false`.
6. THE `app.json` SHALL declare `mcpServers` entries for `exhume` and `exhume-catalogue`, both as stdio servers with `command` `python3` and `args` `["mcp/launch.py", "exhume"]` and `["mcp/launch.py", "catalogue"]` respectively, and the `autoApprove` lists of those entries SHALL contain exactly the tools `open_disk`, `read_grave`, `explain_state`, `list_disks`, `get_disk_card`, `save_disk_summary` and `add_disk_note`, with `exhume` never listed as auto-approved, so that every `exhume` call requires the user's approval.
7. THE `app.json` SHALL reference files inside the installed app folder in MCP server arguments only by the relative path `mcp/launch.py`, because Crew provides no variable for the installed app folder, and no MCP server argument SHALL contain the literal string `~/.kiro/crew/apps/`.
8. THE `app.json` SHALL pass Crew's install-time manifest validation, as checked by installing the app from the local folder.
9. THE README SHALL contain a section "Manual install check" that documents the steps by which the owner confirms, after a local install, that Crew lists the pages, the 2 agents, the `floppy-archive` skill and both MCP servers (`exhume`, `exhume-catalogue`) as available, and the owner SHALL record the result of that check with its date in that section.
10. THE Launcher SHALL be written using only the Python standard library and SHALL NOT import `kiro_crew` or any other third-party module, because Crew rewrites a bare `python3` command in an app `mcpServers` entry to Crew's own Python interpreter.
11. THE Launcher SHALL derive the app folder from the real path of its own file, SHALL locate a `node` executable (on `PATH` first, then in common install locations), and SHALL replace its own process with `node` running the committed server file for the requested mode (`exhume` or `catalogue`).
12. WHEN the Launcher starts in `exhume` mode, THE Launcher SHALL read the Library path only from the Active_Library_File and SHALL start the Exhume_Server with `--root <that path>` only if that path is an existing directory.
13. IF the Active_Library_File is missing or its path is not an existing directory, THEN THE Launcher SHALL write one line to standard error saying that no library is selected and SHALL exit with a non-zero status without starting the Exhume_Server.
14. IF the Launcher finds no `node` executable, or finds one whose major version is lower than 22, or is given a mode other than `exhume` or `catalogue`, THEN THE Launcher SHALL write one line to standard error naming the problem and SHALL exit with a non-zero status without starting any server.

### Requirement 2: Pinned Exhume server

**User Story:** As a maintainer, I want the Exhume bundle pinned and verified, so that disk parsing has one trusted code path.

#### Acceptance Criteria

1. THE Exhume_Crew SHALL ship `mcp/exhume-mcp.mjs` as a byte-for-byte copy of the committed bundle file `power/server/exhume-mcp.mjs` at `exhume` commit 293d283f74992f354f43ae6ae636421a8b2c9df9 (abbreviated 293d283), such that the sha256 recorded in the Pin_Record is the sha256 of that committed bundle file and the test suite compares the sha256 of the shipped `mcp/exhume-mcp.mjs` with it.
2. THE Pin_Record SHALL state the source repo URL, the full 40-character commit hash 293d283f74992f354f43ae6ae636421a8b2c9df9 (293d283 being its abbreviated form), the sha256 of the committed bundle file at that commit as 64 lowercase hexadecimal characters, and the ordered steps to update the pin.
3. IF the sha256 of `mcp/exhume-mcp.mjs` differs from the sha256 in the Pin_Record, THEN THE test suite SHALL fail with a non-zero exit status and an error naming both the expected and the actual sha256.
4. IF the Pin_Record is missing, or lacks a sha256 of 64 hexadecimal characters, THEN THE test suite SHALL fail with a non-zero exit status and an error indicating the Pin_Record is invalid.
5. THE Exhume_Crew SHALL parse Disk_Images only through the Exhume_Server, over stdio JSON-RPC with exactly one JSON message per line terminated by a newline character.
6. THE Exhume_Crew SHALL contain no second copy of the FAT12 reader or of the converters, meaning no source file outside `mcp/exhume-mcp.mjs` (the Launcher included) that parses FAT12 structures or converts Disk_Image file contents.
7. WHEN the Backend starts the Exhume_Server, THE Backend SHALL pass `--root <Library_Root>` as an argument and SHALL NOT pass `--workspace-from-agent`.
8. IF the Exhume_Server fails to start or exits unexpectedly, THEN THE Backend SHALL report an error indicating the Exhume_Server is unavailable, SHALL NOT parse any Disk_Image by other means, and SHALL leave existing Library_Root contents unchanged.

### Requirement 3: Library folder selection and confinement

**User Story:** As a user, I want to choose my library folder safely, so that the app only touches the disks I intend.

#### Acceptance Criteria

1. THE `app.json` SHALL define the Library folder in `setup.configSchema` with a default of `~/Exhume Library`, as a declaration only, and THE Settings_Area SHALL be the control by which the user views and changes the Library path after install.
2. WHEN the user selects "Use demo library" in the Library_Page empty state or in the Settings_Area, THE Exhume_Crew SHALL copy every Disk_Image file from the Demo_Library into the Library without overwriting existing files in the Library that have the same name, and, IF the Library folder does not exist but its parent folder exists, THEN THE Exhume_Crew SHALL create the Library folder first.
3. IF copying the Demo_Library into the Library fails for any file, THEN THE Exhume_Crew SHALL display an error message indicating that the copy failed, SHALL leave files already present in the Library before the copy unchanged, and SHALL remove any partially copied file.
4. WHEN a Library path is set, THE Backend SHALL resolve it with realpath to obtain the Library_Root within 2 seconds.
5. IF the Library_Root is the filesystem root, the user's home directory, or a directory above the home directory, THEN THE Backend SHALL reject the Library path with an error message indicating that the folder is too broad, SHALL scan nothing, and SHALL retain the previously valid Library path, if one exists.
6. IF the Library path does not exist, is not a directory, or cannot be resolved or read by realpath, THEN THE Backend SHALL report an error message indicating the reason, SHALL scan nothing, and SHALL retain the previously valid Library path, if one exists.
7. THE Backend SHALL treat as Disk_Images only regular files inside the Library_Root, including files in subdirectories, whose size is greater than 0 bytes and at most 2,949,120 bytes (2.88 MB), and THE Scanner SHALL exclude the Exhumed_Dir, including its subdirectories, from the scan and from Disk_Image discovery.
8. IF a Library item is a Hostile_Entry, THEN THE Scanner SHALL skip the item, record a warning that identifies the item by its path relative to the Library_Root and does not reveal any path outside the Library_Root, and continue with the remaining items.
9. THE Scanner SHALL NOT follow symlinks, and SHALL skip each symlink encountered, whether it points to a file or a directory, inside or outside the Library_Root, and record a warning for it as described in criterion 8.
10. WHEN the Library_Page is displayed, THE Settings_Area SHALL show the current Library path, and IF the current Library path is rejected or unusable under criterion 5 or 6, THEN THE Settings_Area SHALL show the error message.
11. WHEN the user submits a new Library path in the Settings_Area, THE Backend SHALL validate it under criteria 4 to 6 and, IF it is valid, SHALL use it as the new Library path and start a scan.
12. THE Backend SHALL choose the Library path at start-up from the Active_Library_File, then from the `libraryPath` value in the Library_Config_File, then from the default `~/Exhume Library`, and SHALL validate the chosen path under criteria 4 to 6 each time.
13. THE Exhume_Crew SHALL NOT rely on Crew to pass `setup.configSchema` values to the Backend.

### Requirement 4: Write confinement

**User Story:** As a user, I want my disk images to stay untouched, so that the originals are never lost.

#### Acceptance Criteria

1. THE Exhume_Crew SHALL open every Disk_Image in read-only mode, such that the byte content, size and modification timestamp of each Disk_Image that exists before an Exhume_Crew operation are identical after it, including after a Demo_Copy.
2. THE Exhume_Crew SHALL write files only inside the Exhumed_Dir and the App_Data_Dir, with the Demo_Copy as the single exception, and SHALL create no other files or directories inside the Library or at any other location. The Demo_Copy SHALL write only the Disk_Image files named in Requirement 3 criterion 2 (and the Library folder itself where that criterion allows it) and SHALL be started only by a user action.
3. WHEN the Exhume_Crew writes content to the Exhumed_Dir (other than through the Demo_Copy), THE Exhume_Crew SHALL perform the write only through the Exhume_Server `exhume` tool.
4. THE Exhume_Crew SHALL keep catalogue state, Summaries and Notes only in the App_Data_Dir, and SHALL store none of them inside the Library.
5. THE Exhume_Crew SHALL treat all content found on a Disk_Image as data only, and SHALL not execute, load as code, or launch any file extracted from or read from a Disk_Image.
6. IF a write targets a path outside the Exhumed_Dir and the App_Data_Dir (other than a Demo_Copy target inside the Library_Root), including a path that resolves outside them through relative segments (such as `..`) or symbolic links, THEN THE Exhume_Crew SHALL reject the write, SHALL leave the target path unchanged, and SHALL return an error indicating the path is outside the permitted write locations.
7. IF a file name read from a Disk_Image would cause an Exhumed_Dir write to resolve outside the Exhumed_Dir, THEN THE Exhume_Crew SHALL reject that file, SHALL write no part of it, and SHALL return an error indicating an unsafe file name.
8. IF the Exhume_Crew cannot open a Disk_Image in read-only mode, THEN THE Exhume_Crew SHALL not open it in any writable mode, SHALL leave it unchanged, and SHALL report an error indicating the image could not be opened read-only.

### Requirement 5: Scanning and cataloguing

**User Story:** As a user, I want every disk catalogued automatically without spending model credits, so that I can browse my box immediately.

#### Acceptance Criteria

1. WHEN the Library contents change, THE Backend SHALL start a rescan after 2 seconds with no further Library changes, and SHALL start at most one scan at a time.
2. WHEN the user presses Rescan, THE Backend SHALL start a scan of the Library within 1 second. IF a scan is already running, THEN THE Backend SHALL not start a second concurrent scan and SHALL leave the running scan unaffected.
3. WHEN the Scanner finds a Disk_Image whose Disk_Id is not in the Store, THE Scanner SHALL call `open_disk` on the Exhume_Server, SHALL call `read_grave` for at most 64 readable non-directory entries to collect Formats_Found, SHALL store a Disk_Card, and SHALL complete this for each Disk_Image within 30 seconds.
4. WHEN a Disk_Image changes so that its Disk_Id changes, THE Scanner SHALL call `open_disk` again for that Disk_Image and SHALL replace its stored Disk_Card with the new result, keeping the original first-seen time of the Disk_Image's path.
5. THE Disk_Card SHALL contain label, size in bytes, Geometry, file count (the number of file entries that `open_disk` returned), total entry count and a flag stating whether the returned entry list was truncated, date range (earliest and latest file date, or empty if no dated files), Formats_Found, counts of recovered, partial and lost entries, warnings, Disk_Id and first-seen time.
6. THE Scanner SHALL make no model calls.
7. IF the Exhume_Server returns an error or does not respond within 30 seconds for a Disk_Image, THEN THE Scanner SHALL record a warning on that Disk_Image's Disk_Card indicating the failure, SHALL store no partial `open_disk` results for it, and SHALL continue with the remaining Disk_Images.
8. IF the Exhume_Server process exits unexpectedly, THEN THE Backend SHALL record a warning for the Disk_Image being processed and SHALL start a new Exhume_Server process before scanning the next Disk_Image.
9. THE Backend SHALL assign Card_Status `new` to a Disk_Card without a Summary on first discovery, SHALL change it to `catalogued` once the Disk_Card is stored, and SHALL change it to `summarised` once a Summary exists.
10. WHEN a scan finishes, THE Backend SHALL leave all Disk_Images in the Library byte-for-byte unchanged, including file contents, names and modification times.

### Requirement 6: Store

**User Story:** As a maintainer, I want one shared store module, so that the Backend and Catalogue_Server never disagree or corrupt state.

#### Acceptance Criteria

1. THE Store SHALL persist Disk_Cards, Summaries and Notes in the App_Data_Dir.
2. WHEN the Store writes catalogue state, THE Store SHALL write the new contents to a temporary file in the App_Data_Dir and atomically replace the target file, so that a reader sees either the complete previous contents or the complete new contents and never a partial write.
3. THE Backend and THE Catalogue_Server SHALL access catalogue state only through the Store module.
4. WHILE two or more processes write to the Store concurrently, THE Store SHALL serialize the writes using file locking or a single-writer mechanism so that every completed write is preserved and the stored contents remain readable.
5. IF the Store cannot acquire the write lock within 5 seconds, THEN THE Store SHALL abandon the write, return an error indicating that the Store is busy, and leave the existing stored contents unchanged.
6. IF a write fails before the atomic replacement completes, THEN THE Store SHALL return an error indicating the write failed, remove the temporary file, and leave the existing stored contents unchanged.
7. FOR ALL valid Store contents, writing then reading SHALL produce contents equivalent to the original, with no field of any Disk_Card, Summary or Note added, dropped or altered (round-trip property).
8. IF the Store file is unreadable or malformed, THEN THE Store SHALL return an error identifying the affected file and the reason it could not be read, preserve the original file unmodified under a distinct name in the App_Data_Dir for inspection, and allow the Scanner to rebuild Disk_Cards.

### Requirement 7: Page API

**User Story:** As a UI developer, I want a small authenticated API, so that the pages can show and act on the catalogue.

#### Acceptance Criteria

1. THE Page_API SHALL provide one route for each of the following operations and no route for any other operation: list Disk_Cards, return one Disk_Card with its file list, preview one file, exhume all Recoverable_Entry items of one disk, export the catalogue as CSV, export the catalogue as Markdown, rescan, get scan status and progress, use the demo library, get the Library path and status (the current Library path and its errors), and set the Library path. The Health_Route is not a Page_API route and is governed by criterion 16.
2. IF a request to any Page_API route arrives without a Proxy_Signature (in either accepted header name) or with a Proxy_Signature whose HMAC verification fails, THEN THE Backend SHALL respond with HTTP 401, SHALL not perform the requested action, and SHALL leave the Store and Library_Root unchanged.
3. WHEN a request carries a Proxy_Signature, THE Backend SHALL verify the HMAC before any route handler reads the request parameters or body.
4. IF a parameter of a request to any Page_API route, other than the Library path parameter of the set-Library-path route (which Criterion 15 governs), contains a path traversal sequence (such as `..`, an absolute path, or an encoded equivalent) or resolves outside the Library_Root, THEN THE Backend SHALL reject the request with an HTTP 400 response and SHALL not read or write any file.
5. IF a request names a Disk_Id that is not in the Store, THEN THE Backend SHALL respond with HTTP 404 and SHALL not call the Exhume_Server.
6. IF an error occurs in any Page_API route, THEN THE Backend SHALL return an error response whose message contains no absolute filesystem path and no path outside the Library_Root, and SHALL return no stack trace.
7. WHEN a preview is requested for a file in a known Disk_Id, THE Backend SHALL obtain the content through the Exhume_Server `read_grave` tool and SHALL truncate the response content to at most 65,536 bytes, indicating in the response whether truncation occurred.
8. IF the Exhume_Server `read_grave` call fails or does not respond within 10 seconds, THEN THE Backend SHALL respond with an HTTP 502 or 504 error indicating the preview is unavailable and SHALL not return partial content.
9. WHEN "Exhume all recoverable" is requested for a known Disk_Id, THE Backend SHALL call the Exhume_Server `exhume` tool exactly once per Recoverable_Entry among the entries that `open_disk` returned for that disk (each live file and each deleted entry whose Grade is `recovered`), SHALL skip all other entries, and SHALL return a result list containing one item per called entry with the entry identifier and a success or failure outcome.
10. IF an `exhume` call fails or does not respond within 30 seconds for one entry, THEN THE Backend SHALL record that entry as failed with an error indication in the result list and SHALL continue with the remaining entries, without retrying the failed entry.
11. WHEN a scan status request is received, THE Backend SHALL return the scan state (idle, running or failed), the number of Disk_Images scanned, the total number of Disk_Images and, if the last scan failed, an error message.
12. WHEN a rescan request is received, THE Backend SHALL apply the behaviour defined in Requirement 5 criterion 2.
13. WHEN a use-demo-library request is received, THE Backend SHALL apply the behaviour defined in Requirement 3 criteria 2 and 3.
14. WHEN a Library path and status request is received, THE Backend SHALL return the current Library path together with the current Library path error, if any.
15. WHEN a set-Library-path request carrying a valid Proxy_Signature is received, THE Backend SHALL validate the submitted path under Requirement 3 criteria 4 to 6 (resolve it with realpath, reject the filesystem root, the user's home directory and any directory above it, and reject a path that does not exist or is not a directory), and IF the path is valid, THEN THE Backend SHALL use it as the new Library path and start a scan under Requirement 3 criterion 11. IF the path is rejected, THEN THE Backend SHALL respond with HTTP 400 and an error message that contains no absolute filesystem path, SHALL retain the previously valid Library path, if one exists, and SHALL start no scan. The set-Library-path route SHALL be subject to the Proxy_Signature rule in criteria 2 and 3 and the error rule in criterion 6.
16. WHEN a request to the Health_Route arrives, THE Backend SHALL respond with HTTP 200 and the fixed body `{"ok":true}` without requiring a Proxy_Signature, and the Health_Route SHALL return no other data and perform no other action.
17. WHEN a preview is requested for a PNG file, THE Backend SHALL return the width, height and byte size obtained through `read_grave`, because `read_grave` returns no pixel data, and SHALL include image data (as a `data:image/png;base64,` URL) only IF that entry has been exhumed earlier, in which case the Backend SHALL read the exhumed PNG from the Exhumed_Dir in read-only mode, reject a path that resolves outside the Exhumed_Dir, and return no image data for a file larger than 1.5 MB.
18. WHEN the entry list of a disk is requested, THE Backend SHALL return the entries that `open_disk` returned (at most 200), the total entry count and the truncation flag from the Disk_Card.

### Requirement 8: Catalogue export

**User Story:** As an archivist, I want to export the catalogue, so that I can keep a record outside the app.

#### Acceptance Criteria

1. WHEN CSV export is requested, THE Backend SHALL return a response with MIME type `text/csv` containing one header row followed by exactly one data row per Disk_Card, with the header row containing the same fixed, ordered set of column names on every export.
2. WHEN Markdown export is requested, THE Backend SHALL return a response with MIME type `text/markdown` containing exactly one section per Disk_Card, each section starting with a heading that identifies the Disk_Card and listing all of that Disk_Card's exported fields.
3. WHEN CSV export is requested, THE Backend SHALL enclose in double quotes every field that contains a comma, a double quote or a line break, and SHALL escape each embedded double quote by doubling it.
4. WHEN CSV export is requested, THE Backend SHALL prefix with a single quote character (`'`) every cell whose first character is `=`, `+`, `-` or `@`.
5. FOR ALL valid sets of 0 to 10,000 Disk_Cards, parsing the CSV export SHALL produce the same field values as the exported Disk_Cards, apart from the single-quote prefix added under criterion 4 and the control-character removal under criterion 6 (round-trip property).
6. WHEN CSV or Markdown export is requested, THE Backend SHALL remove from Untrusted_Text all control characters in the Unicode range U+0000 to U+001F and U+007F to U+009F, except that line breaks (U+000A, U+000D) and tab (U+0009) are retained in CSV fields and handled per criterion 3.
7. IF the catalogue contains zero Disk_Cards, THEN THE Backend SHALL return a successful CSV response containing only the header row, or a successful Markdown response containing a document title and no Disk_Card sections.
8. IF an export cannot be generated, THEN THE Backend SHALL return an error response indicating that the export failed and SHALL return no partial file content.

### Requirement 9: Catalogue MCP server tools

**User Story:** As an agent, I want catalogue tools, so that I can read cards and save Summaries and Notes.

#### Acceptance Criteria

1. THE Catalogue_Server SHALL be a hand-written stdio JSON-RPC server with no MCP SDK dependency.
2. THE Catalogue_Server SHALL provide exactly the tools `list_disks`, `get_disk_card`, `save_disk_summary` and `add_disk_note`, and SHALL be started by the Launcher in `catalogue` mode.
3. WHEN `list_disks` is called, THE Catalogue_Server SHALL return at most 200 Disk_Cards, ordered by Disk_Id ascending, together with the total Disk_Card count and a flag indicating whether the result was truncated.
4. WHEN `get_disk_card` is called with a known Disk_Id, THE Catalogue_Server SHALL return that Disk_Card including its current Summary and Notes.
5. IF `get_disk_card`, `save_disk_summary` or `add_disk_note` is called with an unknown Disk_Id, THEN THE Catalogue_Server SHALL return a structured error indicating the Disk_Id was not found and SHALL leave the Store unchanged.
6. WHEN `save_disk_summary` is called with a known Disk_Id, an `agent` argument that is an Agent_Name, and text of 1 to 1200 characters after control-character stripping, THE Catalogue_Server SHALL strip control characters, store the text as plain text with the current time and the `agent` value, replace any previous Summary for that Disk_Id, and return a success result.
7. IF the Summary text exceeds 1200 characters, or is empty after control-character stripping, THEN THE Catalogue_Server SHALL reject the call with a structured error indicating the length violation and SHALL leave the Store unchanged.
8. WHEN `add_disk_note` is called with a known Disk_Id, an `agent` argument that is an Agent_Name, and text of 1 to 500 characters after control-character stripping, THE Catalogue_Server SHALL strip control characters, store the Note as plain text with the current time and the `agent` value, append it to that Disk_Card's Notes, and return a success result.
9. IF the Note text exceeds 500 characters, or is empty after control-character stripping, THEN THE Catalogue_Server SHALL reject the call with a structured error indicating the length violation and SHALL leave the Store unchanged.
10. IF a tool is called with missing or wrongly typed arguments, with an `agent` argument that is not an Agent_Name, or with an unknown tool name, THEN THE Catalogue_Server SHALL return a structured error indicating the invalid request and SHALL leave the Store unchanged.
11. THE Catalogue_Server SHALL return structured JSON responses of at most 256 KB, and SHALL NOT include disk-derived text in tool descriptions or error messages.
12. THE Catalogue_Server SHALL read and write catalogue state only through the Store.
13. FOR ALL valid Summaries, saving then reading the Disk_Card SHALL return text equal to the saved text after control-character stripping (round-trip property).
14. THE Catalogue_Server SHALL treat the `agent` argument as provenance only and SHALL NOT use it to authorise a call, because the tool call identifies no caller; the separation of roles SHALL come from the per-agent tool lists in Requirements 10 and 11.

### Requirement 10: Undertaker agent

**User Story:** As a user, I want an agent that answers questions about a disk and exhumes files on request, so that I can recover what matters.

#### Acceptance Criteria

1. THE Undertaker SHALL have access only to these tools: `exhume`, `explain_state`, `open_disk` and `read_grave` from the Exhume_Server, the read-only tools of the Catalogue_Server (tools that do not create, modify or delete catalogue data), and `add_disk_note`.
2. WHEN the user asks the Undertaker a question about a disk, THE Undertaker SHALL call `open_disk` for that disk before stating any fact about the disk in its response.
3. IF `open_disk` fails or returns an error, THEN THE Undertaker SHALL tell the user in the same response that the disk could not be opened, SHALL state no facts about the disk, and SHALL make no further calls for that question other than a retry the user requests.
4. WHEN the user asks to see the content of a file, THE Undertaker SHALL call `read_grave` for that file and SHALL present the returned preview, without calling `exhume`.
5. WHEN the user explicitly asks to exhume a named file, THE Undertaker SHALL call `exhume` exactly once for that file and SHALL report the outcome (success or failure) to the user in the same response.
6. IF the user asks to see file content or asks a question about a disk without explicitly asking to exhume, THEN THE Undertaker SHALL NOT call `exhume`.
7. IF `exhume` returns an error, THEN THE Undertaker SHALL report to the user that the file was not exhumed and SHALL state the reason returned by the tool.
8. WHEN the user asks about the state of a disk entry, THE Undertaker SHALL call `explain_state` for that entry and SHALL base its answer on the returned result.
9. THE Undertaker SHALL be configured with no shell, network or file-write tools beyond those listed in criterion 1, to the extent the Crew agent specification supports restricting them.
10. IF text read from a disk (including file names, file content and previews) contains instructions directed at the Undertaker, THEN THE Undertaker SHALL report to the user, in the same response, that the disk contains instructions, SHALL NOT follow them, and SHALL NOT call any tool it would not otherwise have called for the user's request.

### Requirement 11: Archivist agent

**User Story:** As a user, I want an agent that writes a factual finding aid for each disk, so that my box is documented.

#### Acceptance Criteria

1. THE Archivist SHALL have access to only the following tools: the read tools of both servers, `save_disk_summary` and `add_disk_note`.
2. THE Archivist SHALL have no `exhume` tool, no shell tool, no network tool and no file-write tool, to the extent the Crew agent specification supports restricting them.
3. WHEN the Archivist processes a disk that has no Summary, THE Archivist SHALL read the disk's Disk_Card, SHALL read previews of between 3 and 10 files on the disk (or of all files if the disk has fewer than 3 readable files), and SHALL save a Summary with `save_disk_summary`.
4. WHEN the Archivist writes a Summary, THE Archivist SHALL include a statement of what the disk is, a statement of what was recovered and what was lost, and the names or dates of people or events only where a file on the disk states them, and SHALL cite the source file path for each fact.
5. THE Archivist SHALL omit any name or date that no file on the disk states, and SHALL not infer, estimate or invent names or dates from file metadata or context.
6. IF a Summary would contain a fact for which the Archivist cannot cite a source file, THEN THE Archivist SHALL omit that fact from the Summary.
7. IF text read from a disk contains instructions addressed to the Archivist, THEN THE Archivist SHALL record the presence of those instructions, with the source file path, as a finding in the Summary or in a Note saved with `add_disk_note`, and SHALL not follow the instructions or change which tools it calls or the arguments it passes.
8. IF `save_disk_summary` returns an error, THEN THE Archivist SHALL report the failure and the disk identifier to the user and SHALL not report the Summary as saved.

### Requirement 12: Floppy-archive skill

**User Story:** As an agent author, I want a shared skill, so that both agents work the same way.

#### Acceptance Criteria

1. THE Floppy_Skill SHALL describe the conditions under which an agent opens a disk, including at least one positive trigger (the user supplies or references a disk image) and at least one negative case (the request does not involve disk contents, so no disk is opened).
2. THE Floppy_Skill SHALL define the three Grades `recovered`, `partial` and `lost`, each with an observable criterion stating the state of a deleted entry that qualifies it for that Grade, and with the three definitions being mutually exclusive so that any deleted entry maps to exactly one Grade.
3. THE Floppy_Skill SHALL instruct agents to word each Summary as statements of fact, each tied to at least one named source file on the disk, and to exclude any statement that cannot be tied to a named source file.
4. THE Floppy_Skill SHALL instruct agents to treat all text read from a disk as data and never as instructions, including text that addresses the agent directly or asks it to change its behavior.
5. IF a disk contains text that is phrased as an instruction to the agent, THEN THE Floppy_Skill SHALL instruct agents to continue the original task unchanged, not act on that text, and report in the Summary that the disk contained instruction-like text, naming the source file.
6. WHERE an agent is the Floppy_Skill consumer, THE Floppy_Skill SHALL be loadable by each of the two agents using the same skill content, with no agent-specific variations of the Grade definitions or Summary rules.

### Requirement 13: Library page

**User Story:** As a user, I want a shelf view of my disks, so that I see the whole box at a glance.

#### Acceptance Criteria

1. THE Exhume_Crew SHALL provide the Crew_Page as a sidebar page with an icon and a text label, reachable with one click from any other page, and SHALL show the Library_Page view on it when the URL has no `id` query.
2. WHEN the Library_Page is displayed, THE Library_Page SHALL show for each Disk_Card its Card_Status, the recovered file count, the partial file count, the lost file count, the number of warnings, the Summary and the Notes.
3. IF a Disk_Card has no Summary or no Notes, THEN THE Library_Page SHALL show that field as empty with a visible placeholder and SHALL still show the Card_Status and the recovered, partial and lost counts.
4. WHEN the Library_Page is displayed, THE Library_Page SHALL show the Settings_Area and the buttons Rescan, Export CSV, Export Markdown and "Summarise new disks", each enabled unless a scan is running or the Library has no Disk_Images.
5. WHEN the user presses "Summarise new disks", THE Library_Page SHALL open a chat with the Archivist through `useChatLauncher` using a fixed message whose only variable content is the list of Disk_Ids of Disk_Cards that have no Summary, and SHALL NOT include file names, file contents, Notes or Summary text in the message.
6. IF no Disk_Card lacks a Summary when the user presses "Summarise new disks", THEN THE Library_Page SHALL NOT open a chat and SHALL show a message indicating that there are no new disks to summarise.
7. WHEN the user selects a Disk_Card, THE Crew_Page SHALL switch to the Disk_Page view for that Disk_Id and set the URL query to `?id=<Disk_Id>` within 500 ms, without changing the route.
8. WHILE the Library has no Disk_Images, THE Library_Page SHALL show an empty state that explains how to set the Library, offers the "Use demo library" action, and SHALL disable the Export CSV, Export Markdown and "Summarise new disks" buttons.
9. WHILE a scan is running, THE Library_Page SHALL show scan progress as the number of Disk_Images scanned out of the total, updated at least once per second, and SHALL disable the Rescan button.
10. IF a scan fails, THEN THE Library_Page SHALL stop showing scan progress, show an error message indicating that the scan failed, keep the previously shown Disk_Cards, and re-enable the Rescan button.

### Requirement 14: Disk page

**User Story:** As a user, I want to see one disk as a graveyard with previews, so that I understand what is recoverable.

#### Acceptance Criteria

1. WHEN the user opens the Disk_Page for a known Disk_Id, THE Disk_Page SHALL list every entry that `open_disk` returned for the disk (at most 200) as a graveyard, with one tombstone for each live file and one open grave for each deleted file, and SHALL show the file name on each entry.
2. WHEN the Disk_Page lists a deleted file, THE Disk_Page SHALL show the Grade and the Grade reason text for that file on its open grave.
3. WHEN the user selects a Markdown file, THE Disk_Page SHALL show a preview pane that renders the file as text with formatting built from DOM nodes.
4. WHEN the user selects a CSV file, THE Disk_Page SHALL show a preview pane that renders the file as a table.
5. WHEN the user selects a PNG file, THE Disk_Page SHALL show a preview pane with the width, height and byte size of the file, and SHALL render the file as an image only IF the Page_API returned image data for it under Requirement 7 criterion 17.
6. WHEN the user presses "Exhume all recoverable", THE Disk_Page SHALL call the Page_API, disable the button until the call completes, and show one result per entry returned, each marked as succeeded or failed.
7. IF the Page_API call from "Exhume all recoverable" fails, THEN THE Disk_Page SHALL show an error indicating the exhume request failed, re-enable the button, and keep the file list and selected preview unchanged.
8. WHEN the user presses "Ask the undertaker", THE Disk_Page SHALL open a chat with the Undertaker through `useChatLauncher` using a fixed message that contains only the Disk_Id and no file names, file contents, or other disk data.
9. IF the `id` query of the Crew_Page URL does not match any known disk, THEN THE Disk_Page SHALL show a not-found state indicating the disk does not exist, and SHALL NOT show the file list or the action buttons.
10. IF a preview fails to load or render, THEN THE Disk_Page SHALL show an error text indicating the failure in the preview pane for that file, and SHALL keep the file list, other file selection, and both action buttons usable.
11. THE Disk_Page SHALL show on the "Exhume all recoverable" button a tooltip stating that the button exhumes live files and deleted entries graded `recovered`.
12. IF the Disk_Card of the open disk has a truncated entry list, THEN THE Disk_Page SHALL show a visible notice stating the number of entries shown and the total entry count, and stating that "Exhume all recoverable" covers only the entries shown.
13. WHEN the Crew_Page loads with an `id` query that matches a known disk, THE Crew_Page SHALL open the Disk_Page view for that Disk_Id.

### Requirement 15: UI safety and accessibility

**User Story:** As a user, I want hostile disk content to render harmlessly, and the pages usable by keyboard.

#### Acceptance Criteria

1. WHEN THE UI renders Untrusted_Text, THE UI SHALL insert it into the DOM only with `textContent` or equivalent text-node APIs, and SHALL NOT use `innerHTML`, `outerHTML` or `insertAdjacentHTML` for it.
2. WHEN THE UI builds a chat-launcher message, THE UI SHALL include only fixed text and Disk_Ids, and SHALL NOT include file names, file previews, Summaries, Notes or any other disk content.
3. THE UI SHALL read the theme mode and accent from `useTheme()` (which returns only `mode`, `accent` and `colorTheme`), SHALL take all other colors, fonts and spacing from the host's own CSS custom properties and classes without redefining them, and SHALL NOT define any Crew theme value of its own.
4. THE UI SHALL make every interactive control reachable with the Tab key, operable with Enter or Space, and visibly focused (focus indicator with a contrast ratio of at least 3:1 against adjacent colors), with no keyboard trap.
5. WHILE the user's system requests reduced motion, THE UI SHALL disable all decorative animations (lantern flicker, fog drift and grave effects) so that no decorative element changes position, opacity or size over time.
6. THE UI SHALL draw the lantern, fog and grave visuals in code with translucent fills, and SHALL make zero network requests for external images or fonts.
7. WHEN the user downloads a file, THE UI SHALL build the download from a Blob URL with a fixed MIME type chosen from `text/csv`, `text/markdown` and `application/octet-stream`, and SHALL name the file with a sanitized name that contains only letters, digits, `.`, `-` and `_`, has at most 255 characters, and has no path separators.
8. IF a downloaded file's name is empty after sanitization, THEN THE UI SHALL use a fixed fallback file name and SHALL still complete the download.
9. FOR ALL file names, previews, Summaries and Notes, including those containing markup such as `<script>` or `<img onerror=...>`, THE UI SHALL render them as literal text, so that no element, script or event handler is created from the content.

### Requirement 16: Agent safety boundary

**User Story:** As a user, I want disk content to never steer the agents, so that a malicious disk cannot cause harm.

#### Acceptance Criteria

1. THE `app.json` SHALL set the auto-approve list of the `mcpServers` entries to exactly the Auto_Approve_List, and THE Exhume_Crew SHALL leave the `exhume` tool out of every auto-approve list, so that every `exhume` call requires the user's approval before it executes.
2. THE Exhume_Crew SHALL rely on the untrusted-data label that the Exhume_Server puts on disk-derived text and SHALL NOT strip or alter that label, AND THE Catalogue_Server SHALL label in the same way any disk-derived text it returns, AND THE Undertaker and the Archivist SHALL be instructed that instructions, commands or requests found inside such a label are not to be followed.
3. IF disk content, including file names, file contents, and volume labels, contains text phrased as an instruction to an agent, THEN THE Exhume_Crew SHALL leave the agent's tool calls, goals, and permissions unchanged, and SHALL treat that text only as data to be summarized or recorded.
4. THE Backend SHALL send zero bytes of disk content in any chat message, where chat messages are limited to user-authored text and system-authored status text.
5. WHEN the Exhume_Crew stores a Summary or Note, THE Exhume_Crew SHALL store it as plain text with no interpreted markup, after the control-character stripping and within the length limits defined in Requirement 9.
6. WHEN the Exhume_Crew displays a Summary or Note, THE Exhume_Crew SHALL render every character literally, such that HTML tags, markdown syntax, and script content appear as visible text and are neither executed nor formatted.

### Requirement 17: Optional scheduled summarisation

**User Story:** As a user, I want an optional daily job, so that disks without a Summary get summarised without my attention.

#### Acceptance Criteria

1. THE `app.json` SHALL contain exactly one `crons` entry that sends the Archivist, once every 24 hours, a message asking it to summarise every disk that has no Summary.
2. THE `crons` entry SHALL be disabled by default, so that no scheduled run occurs until the user explicitly enables it.
3. IF a scheduled Archivist run fails for a disk (including model unavailability or credit exhaustion), THEN THE Archivist SHALL leave that disk without a Summary, SHALL continue with the remaining disks, and SHALL include that disk in the next scheduled run.
4. THE Backend scan SHALL complete and register disks with the cron enabled, disabled, or failing, and SHALL NOT read, wait on, or require any cron state.
5. WHILE the cron is enabled, THE scheduled run SHALL proceed without user approval prompts only because the tools it calls are in the Auto_Approve_List.
6. THE README SHALL state that enabling the cron spends model credits on each scheduled run, and SHALL state how to enable and disable the cron.

### Requirement 18: Demo library

**User Story:** As a judge, I want a ready demo shelf, so that I can see the app work in two minutes.

#### Acceptance Criteria

1. THE Demo_Library SHALL contain exactly four disk image files: three Exhume demo disks (`damaged-disk.img`, `office-disk.img`, `writers-disk.img`) and one unmodified FreeDOS 1.3 image (`fd13-720k-dsk01.img`).
2. THE Demo_Library SHALL include a `NOTICE.md` file that contains the FreeDOS GPL notice and a statement of the origin of each of the three generated disks.
3. WHEN the Backend scans the Demo_Library, THE Scanner SHALL produce exactly four Disk_Cards, one per disk image file, whose content is identical to the committed golden JSON, excluding fields that vary per run (scan timestamps and absolute file paths).
4. WHEN the Backend scans the Demo_Library on a machine with no network access, THE Scanner SHALL complete the scan within 10 seconds and produce the same four Disk_Cards.
5. IF a disk image in the Demo_Library is missing or unreadable, THEN THE Scanner SHALL report an error identifying the affected file and SHALL still produce Disk_Cards for the remaining readable disk images.
6. WHEN the FreeDOS image in the Demo_Library is hashed with SHA-256, THE hash SHALL equal the hash of the upstream FreeDOS 1.3 image recorded in `NOTICE.md`.

### Requirement 19: Testing

**User Story:** As a maintainer, I want automated tests, so that safety and behaviour are verified.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest and fast-check, with test files located in `src/**/*.test.ts` and `backend/**/*.test.ts`, and the UI DOM tests SHALL be located in `src/ui-dom/` (importing the UI sources from `ui/src/`) so that they match that glob.
2. WHEN the test suite runs, THE test suite SHALL verify that a scan of the Demo_Library produces output equal to the golden JSON, with zero differing fields.
3. WHEN an image file in the Library changes (content or modification time), THE test suite SHALL verify that a refresh updates the corresponding Disk_Card to reflect the new image and leaves the Disk_Cards of unchanged images unmodified.
4. IF a scanned Library contains a Hostile_Entry (a symlink, a file larger than the maximum image size, a non-image file, an image resolving outside the Library, or a name containing control characters), THEN THE test suite SHALL verify that the scan skips that entry, emits at least one warning identifying the entry, completes without throwing or terminating the process, and still returns Disk_Cards for all valid images in the same Library.
5. IF a request carries a missing or incorrect Proxy_Signature, THEN THE test suite SHALL verify that the backend responds with HTTP 401 and performs no action for that request.
6. IF an API request path contains a traversal sequence (such as `..`, or its percent-encoded form) that would resolve outside the Library, THEN THE test suite SHALL verify that the backend rejects the request and returns no file content from outside the Library.
7. WHEN the test suite runs, THE test suite SHALL invoke each Catalogue_Server tool in-process and verify its successful response, and SHALL verify for each tool that result-size caps are enforced, that stripping is applied to returned content, and that an unknown Disk_Id returns an error response indicating the Disk_Id was not found.
8. WHEN the test suite runs, THE test suite SHALL compute the hash of the bundle and verify that it equals the pinned bundle hash, and SHALL fail if the values differ.
9. THE test suite SHALL include a fast-check property test, run for at least 100 generated cases, verifying that data written to the Store and read back equals the original data.
10. THE test suite SHALL include a fast-check property test, run for at least 100 generated cases, verifying that CSV export output parses back to data equal to the exported data.
11. WHEN the test suite renders a Disk_Card or Summary whose name or text contains markup (such as `<script>` or `<img onerror>`), THE test suite SHALL verify in a DOM test that the content appears as literal text and that the rendered DOM contains no element created from that markup.
12. THE property-test callbacks SHALL return either nothing or a boolean, and SHALL NOT call `expect`.
13. THE test suite SHALL exclude the Exhumed_Dir from every test glob, so that zero test files under the Exhumed_Dir are discovered or run.
14. THE test suite SHALL verify that the Health_Route answers without a Proxy_Signature, that both header names `X-KiroCrew-Proxy` and `X-Crew-Proxy` are accepted, and that every Page_API route answers HTTP 401 without a valid Proxy_Signature.
15. THE test suite SHALL verify that the root `package.json` declares no runtime dependencies, as defined in Requirement 20 criterion 4.

### Requirement 20: Technology constraints

**User Story:** As a maintainer, I want consistent tech rules, so that the code stays small and auditable.

#### Acceptance Criteria

1. THE Exhume_Crew SHALL be written in TypeScript compiled with strict mode enabled (the Launcher being the only source file in another language), SHALL contain zero occurrences of the `any` type (explicit or via type assertion to `any`) in source files, and SHALL declare a minimum supported runtime of Node 22.0.0.
2. THE Exhume_Crew SHALL commit the built `backend/server.mjs`, `mcp/catalogue-mcp.mjs` and the `ui/dist/` bundle to version control, so that a fresh clone runs without executing a build step.
3. WHEN the build command is run on a clean checkout, THE Exhume_Crew SHALL produce `backend/server.mjs`, `mcp/catalogue-mcp.mjs` and `ui/dist/` with contents identical to the committed versions.
4. THE root `package.json` SHALL declare no runtime dependencies, meaning `dependencies` is empty or absent and every package is under `devDependencies` pinned to an exact version, so that Crew's `npm install --production` on a `package.json` without `node_modules` fetches nothing; a test SHALL enforce this.
5. THE Exhume_Crew SHALL make zero outbound network connections during runtime operation, SHALL contain no credentials, API keys, or tokens in committed files, and SHALL include no analytics or telemetry code.
6. THE Exhume_Crew SHALL launch every server process, including MCP servers, only from a locally committed file or from a dependency pinned to an exact version, and SHALL not invoke `npx` or reference a `latest` tag or unpinned version range at runtime.
7. IF the runtime Node version is lower than 22.0.0, THEN THE Backend and THE Catalogue_Server SHALL exit within 2 seconds with a non-zero exit code and an error message indicating the required minimum Node version.

### Requirement 21: Documentation and repository rules

**User Story:** As a reader, I want honest documentation, so that I know what was verified and what is assumed.

#### Acceptance Criteria

1. THE README SHALL contain a distinct section for each of the following: what the app does, how to install it (listing each install step in order), the verified Crew behaviours, the accepted residual risks, and a credits section naming the Exhume repo and andete/disk-peek as prior art.
2. THE README SHALL list each Crew behaviour under exactly one of two headings, "Verified by hand" or "Assumed", and no Crew behaviour named in the README SHALL appear under neither heading.
3. WHEN a Crew behaviour is listed under "Verified by hand", THE README SHALL state the date of verification and the method used (manual run in Crew, Crew documentation, or built-in app inspection).
4. THE README SHALL contain a statement of how app MCP arguments reference files inside the installed app folder (a relative `.py` launcher path with `command` `python3`, which Crew resolves to the installed app folder), naming the source it was verified from (Crew documentation, Crew source or a named built-in app), and SHALL state that the Launcher must be stdlib-only and import no `kiro_crew` module because Crew rewrites a bare `python3` to its own interpreter.
5. IF the file-reference convention for MCP arguments has not been verified from the Crew documentation or a built-in app, THEN THE README SHALL list it under "Assumed" and SHALL NOT present it as verified.
6. THE repository SHALL track the `.kiro/` directory in version control, including its steering files, specs, and hooks, and `.gitignore` SHALL NOT exclude any of them.
7. THE repository SHALL contain `docs/KIRO_LOG.md` with two separate sections: one listing what Kiro generated and one listing what was fixed by hand, each with at least one entry or the explicit text "None".
8. THE `design.md` SHALL contain a section listing each Crew behaviour verified from the Crew documentation or built-in apps, with its source, and a separate section listing each Crew behaviour that remains an assumption.
9. THE Crew behaviours listed as verified or assumed in the README SHALL match the "Verified Crew behaviours" and "Assumptions" lists in `design.md`, which are the reference, with no behaviour classified differently between the two documents; WHEN a behaviour moves from assumed to verified, THE README and `design.md` SHALL be updated in the same commit.
10. THE README SHALL state, in its accepted residual risks section, that a hostile disk can at worst make an agent read other disks in the library or write misleading capped text into a Summary or Note, and that it cannot write files, reach the network or leave the library.
