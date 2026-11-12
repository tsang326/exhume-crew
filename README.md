# Exhume Crew

A Kiro Crew app that catalogues a box of old DOS floppy disk images and lets two agents read, explain and exhume
them. Built on [Exhume](https://github.com/tsang326/exhume). Work in progress for Kiroween 2026.

## What the app does

Exhume Crew (`exhume-crew`) scans a folder of floppy disk images (the Library) and shows one card per disk on a
single page: status, recovered, partial and lost counts, warnings, a Summary and Notes. A disk view lists every
entry that Exhume returned, previews Markdown, CSV, PNG and text, and can exhume all recoverable entries.

- **Page and Backend.** A Node backend scans the Library, keeps the catalogue in the app data dir and serves the
  page through the Crew gateway. It can export the catalogue as CSV or Markdown.
- **Two agents.** `exhume-undertaker` opens disks, reads files and exhumes on request. `exhume-archivist` reads
  previews and writes a Summary or Note that cites source files. The archivist has no `exhume` tool.
- **One skill.** `floppy-archive` tells agents when to open a disk, how the three Grades differ, and that text on a
  disk is data and never an instruction.
- **Two MCP servers.** `exhume` is the pinned Exhume server (`mcp/exhume-mcp.mjs`, see `mcp/PINNED.md`).
  `exhume-catalogue` lets agents list cards and save capped plain-text Summaries and Notes.
- **One cron, disabled by default.** It asks the archivist once a day to summarise disks that have no Summary.

A disk image is untrusted bytes from a stranger. All disk parsing happens in the pinned Exhume server. The app
writes only to `<library>/exhumed/` (through Exhume's `exhume` tool, which always asks for approval) and to its own
data dir. The one user-initiated exception is the "Use demo library" copy into the Library.

## Install

Requirements: Kiro Crew 0.12.1 or newer (`minKiroCrewVersion`), macOS or Linux, and Node.js 22 or newer on the
machine. The built files (`backend/server.mjs`, `mcp/catalogue-mcp.mjs`, `ui/dist/index.mjs`) are committed, so
there is no build step and no runtime npm dependency.

1. Clone this repository.
2. Install from the local folder: `kirocrew app install <path to this folder>`. This copies the folder to
   `~/.kiro/crew/apps/exhume-crew/`. (The API form is `POST /api/apps/install` with `{"source": "/path"}`.)
3. Enable it: `kirocrew app enable exhume-crew`.
4. Open the Exhume Crew page from the Crew sidebar.
5. Choose the Library. The default is `~/Exhume Library`. The Settings area on the page is the control for changing
   it. The home directory and `/` are rejected.
6. To try it without your own disks, press "Use demo library" in the empty state. This copies the four images from
   `demo-library/` into the Library without overwriting anything.
7. Run the [Manual install check](#manual-install-check).

For development, `kirocrew app dev exhume-crew` runs the live-reload mode. To rebuild the committed files:
`npm install`, then `npm run build`. `npm test` runs the automated checks.

## How MCP arguments reference app files

Crew gives MCP server arguments no variable for the installed app folder. Arguments are expanded only for `HOME`,
`USER`, `LOGNAME`, `USERPROFILE` and `USERNAME`. The only anchoring Crew does is for a bare Python launcher
(`python`, `python3`, `py`) whose launch target is a relative path ending in `.py` that resolves to a file inside
the app root: Crew rewrites it to the absolute path. A relative `.mjs` with `command: "node"` is not anchored.

So both MCP servers in `app.json` use `command: "python3"` with `args: ["mcp/launch.py", "exhume"]` and
`args: ["mcp/launch.py", "catalogue"]`. No argument contains `~/.kiro/crew/apps/`. The launcher derives the app
folder from the real path of its own file and then `exec`s `node` on the committed server file.

Verified from the Crew 0.12.1 source, not from a manual run: `kiro_crew/apps/bridges_mcp.py`
(`_resolve_app_launcher_arg`, `resolve_stdio_command`) and `kiro_crew/env.py` (`_SPEC_ARG_VARS`,
`expand_spec_args`). The docs are silent on this. See V5 and V23 below; the check that Crew really writes the
absolute path is A3, which is still Assumed.

Because Crew rewrites a bare `python3` to its own interpreter (V23), `mcp/launch.py` must use only the Python
standard library and must import no `kiro_crew` module. It is the only Python file in the repository.

## Verified Crew behaviours

The date for every row below is **2026-11-11**. The method for every row is reading, not running: the fetched
kiro.dev docs pages (`/docs/crew/apps`, `/docs/crew/apps/manifest`, `/docs/crew/apps/sdk`; the docs footer says
"Page updated: October 12, 2026"), the source and shipped docs of the installed Kiro Crew 0.12.1 (`Info.plist`;
`CHANGELOG.md` top entry dated 2026-11-09), and the built-in apps `auto_improvement`, `mochi`, `personal_shopper`
and `design_tweak`. No app was installed or run, and no sandbox behaviour was tested.

`$KC/` is `/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend/lib/python3.12/site-packages/kiro_crew/`.
"Docs" means the fetched kiro.dev pages. Where the docs and the installed build disagree, the row says which was
followed. The rule used: the installed 0.12.1 source wins over the docs, because the app runs on that build and
`minKiroCrewVersion` pins it.

Crew requires the owner to trust a third-party app before it can be enabled. Enabling from the CLI is refused by
policy; the dashboard shows a trust prompt instead. (Read from docs and source, not yet verified by hand.)

Nothing is listed under "Verified by hand" yet. Per Requirement 21.2, every Crew behaviour in this README is under
exactly one of the headings "Verified by hand" or "Assumed". Behaviours that were only read from docs or source
are shown below under their own heading and are not claimed as run in Crew.

### Verified by hand

None yet. Nothing is moved here until the owner's final task (task 18), which runs the manual checks in an installed
Kiro Crew 0.12.1 and records the date and method per item. The same change must update `design.md`.

### Verified from documentation, source and built-in apps (V1 to V23)

| ID | Behaviour | Source | What was seen |
|----|-----------|--------|---------------|
| V1 | Install from a local folder | Docs `/crew/apps`; `$KC/apps/manager_install.py` (`install` docstring); `$KC/apps/scaffold.py` README template | `POST /api/apps/install` with `{"source": "/path"}` or `kirocrew app install <dir>`, then `kirocrew app enable <name>`. The folder is copied to `~/.kiro/crew/apps/{name}/` and recorded with `origin = "local"`. `kirocrew app dev <name>` is the live-reload mode. Docs: build output must be committed (`node_modules`, `.git`, `__pycache__`, `.venv` are excluded from the copy; symlinks are not followed). |
| V2 | Manifest field shapes and install-time validation | Docs `/crew/apps/manifest`; `$KC/apps/manifest.py` | `name` kebab-case, `version` semver, `crons[]` with `every` or `cron_expr`, `message`, `agent`, `enabled` (JSON boolean), `ui.entry`, `ui.pages[]`, `ui.sidebar`, `backend.{entryPoint,type,port,healthCheck}`, `permissions.*`, `setup.configSchema`, `platform.os`, `dependencies.commands`. Paths in `agents`, `skills`, `ui.entry`, `backend.entryPoint` must be relative and stay inside the app root. Docs: `mcpServers` entries "use command / args / url / env — not app-relative file paths — and are not path-checked". |
| V3 | Cron entry and how the message reaches an agent | Docs `/crew/apps/manifest`; `$KC/apps/manifest.py` (`cron_permission_error`); `$KC/apps/bridges_crons.py` (`_cron_defs_from_manifest`); `$KC/docs/cron-and-scheduling.md` | `message` is the prompt sent to `agent` on each run; `enabled: false` registers the job paused. A manifest with `crons` and no `permissions.cron: true` fails validation. The job is registered as `{app}/{cron name}`. Default `persistent_session` jobs append to one chat tab `Cron: <name>`. `approval_mode: "auto"` can only be switched on by the owner on the Schedule page, so an unattended run depends on tool auto-approve entries. |
| V4 | App MCP servers are registered namespaced, and the auto-approve field is `autoApprove` | `$KC/apps/bridges_mcp.py` (`_register_mcp_servers`); `$KC/apps/builtins/auto_improvement/app.json` | Server key becomes `{app}:{server}` (here `exhume-crew:exhume`, `exhume-crew:exhume-catalogue`) in Crew's own agent config `kirocrew.json`. A stdio entry is always registered. The built-in `auto-improvement` manifest uses `"autoApprove": ["get_status", ...]` inside its `mcpServers` entry. A governance pass (`strip_ungoverned_auto_approve`) removes grants only on hosts that have a governance ceiling; the source comment says it is a no-op on an ungoverned host. |
| V5 | **How MCP args reference files in the installed app folder: there is no variable.** | `$KC/env.py` (`_SPEC_ARG_VARS`, `expand_spec_args`); `$KC/apps/bridges_mcp.py` (`_resolve_app_launcher_arg`, `resolve_stdio_command`) | Args are expanded only for `HOME`, `USER`, `LOGNAME`, `USERPROFILE`, `USERNAME`; "any wider set would put an arbitrary variable's VALUE on argv". The only app-root anchoring is `_resolve_app_launcher_arg`: when the command is a bare Python launcher (`python`, `python3`, `py`) and the launch target is a **relative path ending in `.py`** that resolves to a file inside the app root, Crew rewrites it to the absolute path. Its docstring says MCP servers start under the session's cwd, so a relative operand otherwise never reaches the app file. A relative `.mjs` with `command: "node"` is not anchored. Docs are silent on this; the source was followed. |
| V6 | Agent spec fields that restrict tools | `$KC/docs/agent-spec-fields.md` (rows `tools`, `allowedTools`, `mcpServers`, `includeMcpJson`); `$KC/apps/builtins/mochi/agents/mochi-bg.json`; `$KC/apps/bridges_agents.py` | `tools` is what is **mounted**: `"*"`, `@server` (whole server) or `@server/tool` (one action). `allowedTools` is what is **auto-approved** (globs, `@srv/*`). Absent `tools` on the KAS path means no tools. `includeMcpJson: false` keeps global servers out. `managedToolPolicy.exclude` removes named Crew-managed tools (`mochi-bg.json` lists `spawn_run`, `cron_add`, `cron_remove`, `cron_update`, `cron_remove_all`, `task_run`). `bridges_agents.py` withholds every host-managed tool the app did not declare via `permissions.mcpTools`. Per-MCP-tool restriction is therefore documented (`@server/tool`). The reference form for an app server is `@mochi:mochi` (whole server) in `mochi-bg.json`. |
| V7 | App agents and skills registration | `$KC/apps/bridges_agents.py` (`_register_agents`); `$KC/apps/bridges_skills.py`; `$KC/apps/builtins/personal_shopper/` | Agent JSON is copied to `~/.kiro/agents/{app}--{file stem}.json`; the declared `name` field stays the dispatchable name. The app's own `mcpServers` are merged into each agent's `mcpServers`. Built-in agent names carry an app prefix (`mochi-bg`, `auto-improvement-scout`). A skill is a directory with `SKILL.md` (frontmatter `name`, `description`, `triggers`), linked to `~/.kiro/crew/skills/{app}/{skill}`; an agent lists it as `"skills": ["personal-shopper"]`. |
| V8 | Node backend: port, environment, working directory, install side effect | `$KC/apps/backend.py` (Node branch around "Node.js backend", env block with `minimal_env`) | Backend is launched as `node <absolute entry>` with `cwd` = app root and `NODE_ENV=production`. Environment is a minimal one containing `PORT`, `KIROCREW_APP_NAME`, `KIROCREW_HOME`, `KIROCREW_PROXY_SECRET` (read from `<app>/.app_secret`) and the gateway-origin variables. For every directory from the app root down to the entry's folder that has a `package.json` and no `node_modules`, Crew runs `npm install --production --no-audit --no-fund` (120 s timeout, sandboxed). A failed install is only logged. The scaffold backend binds `127.0.0.1:PORT`. Node is found via nvm, then `PATH` (`_find_node_binary`). Docs: `backend.type` accepts `"node"`. |
| V9 | Health check | Docs manifest (`backend.healthCheck` default `/health`); `$KC/apps/proxy_auth.py` docstring | The gateway's own health probe hits the backend directly and unsigned, so `/health` must not require the proxy signature. |
| V10 | Reverse proxy shape | Docs `/crew/apps`; `$KC/apps/routes_proxy.py` (`handle_app_api_proxy`) | `/apps/{name}/api/{path}` is forwarded to the backend as `/api/{path}[?query]`, any method. A `..` in `path` gives 400. A disabled app gives 403. The gateway removes its own `?token=` and signs the **raw** request target. |
| V11 | **HMAC details** | `$KC/apps/proxy_auth.py`; `$KC/apps/routes_proxy.py` lines that build the header; docs `/crew/apps` and `/crew/apps/sdk` | Header `X-KiroCrew-Proxy: <ts>:<hex>`. `ts` is Unix seconds (ASCII digits). `hex = HMAC-SHA256(key = app secret as UTF-8, msg = "<ts>:<METHOD>:<raw request target incl. ?query>:<sha256 hex of body>")`; empty body hashes the empty string. The key is the per-app secret from the file `<app>/.app_secret`, injected into the backend as env `KIROCREW_PROXY_SECRET`. Freshness ±60 s; constant-time compare. **Docs and source disagree on the header name**: docs say `X-Crew-Proxy`, source sends `X-KiroCrew-Proxy`. The source was followed; the backend also accepts the docs spelling. The gateway additionally sends a nonce-bound v2 signature (`X-KiroCrew-Proxy-V2`, `X-KiroCrew-Proxy-Nonce`) and, only if the manifest sets `backend.signedPrincipal`, `X-KiroCrew-Principal`. This design verifies v1 only. |
| V12 | **UI page mount contract and React** | `$KC/static/dist/assets/App-*.js` (AppHost: `lazy(() => import("/apps/${name}/ui/${entry}"))`, render of the `default` export); `$KC/static/dist/apps/demo-app/ui/index.mjs`; `$KC/apps/scaffold.py` UI templates; `$KC/apps/routes_static.py` | The host dynamically imports the module and renders its **default export as a React component**. `ui.entry` is relative to the app's `ui/` folder, so `dist/index.mjs` means `ui/dist/index.mjs`. The host provides `react`, `react-dom`, `react/jsx-runtime`, `lucide-react`, `@tanstack/react-query`, `@kirocrew/app-sdk` on `window.__kirocrew_modules` (and as import-map vendor stubs); the scaffold's Vite config lists them as externals. So the SDK hooks need React and the bundle must treat these as external. The manifest class has `mountFunction` (default `"mount"`) and docs mention it, but **no host JS in 0.12.1 reads it** (searched all `static/dist/assets/*.js`). The default-export component is the contract that is actually used. |
| V13 | Page routing and sidebar | `$KC/static/dist/assets/App-*.js` (routes `/apps/:name`), `appNav-*.js` (`E(e)` takes `ui.pages[0]`); docs manifest | The only app route seen is `/apps/:name`; the sidebar entry uses the first page. No `/apps/:name/*` route was seen. Sidebar placement is `ui.sidebar.section` and `ui.sidebar.order`; `ui.pages[].icon` is a Lucide icon name. |
| V14 | SDK hooks and their real signatures | `$KC/static/dist/assets/App-*.js` (functions behind `useAppApi`, `useTheme`, `useChatLauncher`, `useNavigate`); `$KC/static/dist/vendor/kirocrew-app-sdk.mjs`; docs `/crew/apps/sdk` | `useAppApi()` returns `{ raw, request, get, post, put, patch, del }`; `get/post/put/patch/del` parse the response as JSON (non-JSON throws); `raw(path, init)` returns the `Response`. `useTheme()` returns only `{ mode, accent, colorTheme }` (read from `data-theme`, `--accent`, `data-color-theme` on `<html>`). `useNavigate()` returns `navigate(path)`. `useChatLauncher()` returns **`{ openChat({ agent, message, slotKey, autoSend, memoryMode, sessionFolder }) }`**. **Docs and source disagree**: docs call the return type `LauncherFn`; the source returns an object with `openChat`. The source was followed. Also exported: `useAppInfo`, `useNotify`, `useNavBadge`, `useAppEvents`. |
| V15 | `permissions.api` format and matching | Docs manifest ("Allowed API path prefixes (enforced today)"); host function `$U` in `App-*.js`; built-in manifests (`design-tweak`) | Array of path strings. An entry matches a path if it equals it, if the path starts with `entry + "/"`, or if the entry ends in `/*`. Out-of-scope paths throw in `useAppApi`. Absolute URLs and backslashes are refused. Built-ins declare `"/apps/design-tweak/api"` and `"/apps/design-tweak/api/*"`. |
| V16 | App data dir and `config.json` | Docs `/crew/apps/sdk` (`getAppDataDir()`); `$KC/apps/manager_records.py` (`app_data_dir`); `$KC/apps/routes_listing.py` (`handle_app_config`) | `~/.kiro/crew/apps/{name}/data/`, created owner-only (0700). There is no published TypeScript gateway client (docs), so a Node backend computes the path itself. `GET/PUT /api/apps/{name}/config` reads/writes `data/config.json` (`{}` if absent); PUT needs the dashboard owner. |
| V17 | **How `setup.configSchema` values reach the backend: they do not, automatically** | `$KC/apps/manifest_sections.py` (`configSchema` only serialised); grep of `$KC/` Python and of every `static/dist/assets/*.js` for `configSchema` | The schema is stored and round-tripped. No gateway code passes values as env vars to the backend, and no dashboard code references `configSchema`. The only channel found is `data/config.json` via the config REST endpoint (V16). |
| V18 | `minKiroCrewVersion` | Docs `/crew/apps`; `$KC/apps/version.py`; `Info.plist`, `CHANGELOG.md` | Install and update compare against the running version and reject an older Crew. Installed version is 0.12.1. |
| V19 | `platform` fields | Docs manifest | `platform.os` (default `["macos","linux"]`), `arch`, `installMode`. |
| V20 | Icon | Docs manifest (`iconPath`: PNG, square, min 256x256); `$KC/apps/scaffold.py` (`"iconPath": "assets/icon.png"`); `$KC/apps/registry_pipeline/manifests.py` | `iconPath` is repo-relative and honoured by the store pipeline. |
| V21 | `dependencies.commands` | Docs manifest | Missing required commands block installation, so `["node"]` is declared. |
| V22 | Backend sandbox exists | `$KC/apps/backend.py` (`wrap_argv(cmd, mode="standard", ...)`); `$KC/sandbox_seatbelt.py` | The backend process is wrapped by an OS sandbox in "standard" mode. The seatbelt profile is built from deny rules for masked sub-paths. What it allows for a user library folder was **not** tested (see A9). |
| V23 | **A bare `python3` command is rewritten to Crew's own interpreter** | `$KC/apps/bridges_mcp.py`: `_BARE_PYTHON = frozenset({"python", "python3", "py"})` (about line 182) and `resolve_stdio_command` (about line 225) | The docstring says bare Python launchers are resolved to the venv/gateway interpreter, with a `sys.executable` fallback. A bare PATH dependency that the app does not provide (`node`, `npx`, `docker`) is deliberately left untouched. Consequences: (1) no system Python is needed to run `python3 mcp/launch.py`; (2) `mcp/launch.py` MUST stay standard-library only, MUST NOT import `kiro_crew` and MUST NOT assume any dependency directory, because it runs under Crew's interpreter, not a plain system one; (3) `node` is **not** rewritten, so whether the launcher can find `node` in the MCP subprocess environment remains an assumption (A4). |

## Assumptions

### Assumed (A1 to A14)

Each assumption names the risk and the by-hand check. All fourteen are **Assumed** today. None has been checked in
an installed Crew.

| ID | Assumption | Risk if wrong | How it is checked by hand |
|----|-----------|---------------|---------------------------|
| A1 | `tools` entries of the form `@exhume-crew:exhume/open_disk` mount exactly one tool of an app-namespaced server. Only `@mochi:mochi` (whole server) was seen in a real agent file; `@server/tool` is documented; the combination with the namespaced server name is untested. | Tools do not mount, or a whole server mounts. A whole-server mount would give the archivist an `exhume` tool. | After `enable`, open a chat with each agent and ask it to list its tools. Fallback if per-tool refs fail: mount whole servers with `@exhume-crew:exhume` and rely on the missing auto-approve for `exhume` plus the prompt rules; record the weaker boundary in the README. |
| A2 | `autoApprove` in the app's `mcpServers` entries suppresses approval prompts on the kiro-cli/KAS path, in chat and in cron runs; `exhume` always prompts. The agent JSON also lists the same tools in `allowedTools` to cover the KAS projection described in V6. | A tool prompts when it should not (cron stalls), or worse, `exhume` does not prompt. | In chat: call `open_disk` (no prompt), `exhume` (prompt). Enable the cron once and check the Schedule page run: it must finish without approval prompts. Check `~/.kiro/agents/kirocrew.json` for the written entries. |
| A3 | Crew rewrites `args[0] = "mcp/launch.py"` to the absolute path inside `~/.kiro/crew/apps/exhume-crew/` when it writes `kirocrew.json`. The code path was read (V5, V23) but never executed here, so the app-root-relative anchoring stays an assumption. | Servers fail to start from the session cwd. | After `enable`, read the registered entries in `~/.kiro/agents/kirocrew.json`; the arg must be absolute. Then use an agent tool. |
| A4 | `launch.py` can find `node` under a stripped environment (`bridges_mcp.py` mentions kiro-cli stripping env). That the launcher itself runs under Crew's own Python is verified (V23); only the discovery of `node` is assumed, because Crew does not rewrite `node` (V23). | MCP servers fail to start. | Launcher tries `PATH`, nvm, `/opt/homebrew/bin`, `/usr/local/bin`, and prints one clear stderr line on failure. Check with a stripped `PATH` in a manual run of `python3 mcp/launch.py exhume`, then use an agent tool in Crew. |
| A5 | Changing the query string of `/apps/exhume-crew` does not remount the page; the component can read `window.location.search` on mount and keep its own view state. Sub-routes such as `/apps/exhume-crew/disk` were not seen in the host router (V13). | Deep links to a disk do not work, or a reload loses the view. | Open `/apps/exhume-crew?id=<id>` directly and reload; use the in-app navigation and the browser Back button. |
| A6 | `useAppApi().raw()` (present in the host code, absent from the docs) is permission-scoped like `get`. It is used for CSV/Markdown downloads and the PNG data path is JSON. | `raw` disappears in a later Crew release; downloads break. | Click Export CSV and Export Markdown. Fallback: add `?format=json` variants returning `{ filename, mime, content }`, which would change Requirement 8.1's wording. |
| A7 | `openChat({ agent: "exhume-archivist", message, autoSend })` resolves the declared agent `name`, and `autoSend` sends the message without further input. | The chat opens with the default agent. | Press "Summarise new disks" and check the chat header agent name. |
| A8 | Cron `agent: "exhume-archivist"` is accepted as the declared name. | Cron runs on the default agent. | Enable the cron, use "run now" on the Schedule page if available, or wait one interval set temporarily to 60 s in a dev copy. |
| A9 | The "standard" backend sandbox lets the backend read the user library folder, write `data/`, and lets its Exhume child write `<library>/exhumed/`; `fs.watch` with `recursive: true` works inside it. | Scans or exhume fail with permission errors. | Run the demo library flow end to end. Watcher falls back to polling (design below), so only read/write access is critical. |
| A10 | `<app>/.app_secret` is created when the app with a backend is enabled, so `KIROCREW_PROXY_SECRET` is set. | Backend has no secret and rejects every request (fails closed, with 401). | Open the Library page after enable; if empty, check the gateway log. |
| A11 | The dashboard does not render a form from `setup.configSchema` in 0.12.1 (nothing in the host JS refers to it, V17). If a later Crew writes `config.json`, the backend honours `libraryPath` there as a fallback. | Install-time folder choice (Requirement 3.1) is only declarative. | Install and look for a prompt. The Settings_Area is the working path. |
| A12 | Browser Tailwind classes used by the host's demo app (`text-muted`, `bg-card`, `border-border`, `text-text-strong`) and CSS variables like `--accent` are available to app pages. Only `--accent`, `--card-hl` and `data-theme` were seen read by host code. | Page looks unstyled or wrong in one theme. | Open the page in light and dark mode. Custom visuals use inline styles and `var(--accent)` with fallbacks, not Tailwind arbitrary values. |
| A13 | The browser History API (`replaceState`) can update the query string without confusing the host router. | URL and view get out of sync. | Same check as A5. |
| A14 | Local install does not run any `setup.onInstall`/build step and keeps `data/` across `app update`. No `setup` scripts are declared, so only the second half matters. | Catalogue lost on update (rebuilt by the next scan; summaries and notes would be lost). | Update the app and check the catalogue. |

## Manual install check

**Status: pending.** The owner has not yet run this check. It is performed by hand in an installed Kiro Crew 0.12.1
(task 18) and nothing here is filled in by the coding agent.

Steps:

1. Install from the local folder and enable the app (see [Install](#install)).
2. Confirm Crew lists the Exhume Crew page, the two agents (`exhume-undertaker`, `exhume-archivist`), the
   `floppy-archive` skill and both MCP servers (`exhume`, `exhume-catalogue`) as available.
3. Run the by-hand check for each of A1 to A14 above.
4. With the demo library: open a disk; ask the undertaker for a file, then to exhume it (an approval prompt appears
   for `exhume` only); let the archivist summarise one disk and check the Summary cites file names; check that an
   instruction-bearing text file is reported and not followed; do a keyboard-only pass; check focus ring contrast
   in light and dark mode with reduced motion on; enable the cron once and confirm it runs without prompts.

Result: _pending_ (date: _pending_)

## Cron: enable, disable and cost

The app declares one cron, `exhume-crew/summarise-new-disks`. Once every 24 hours it sends the archivist a message
asking it to summarise every disk that has no Summary. It is **disabled by default**, so no scheduled run happens
until you turn it on.

**Enabling the cron spends model credits on each scheduled run.** If a run fails for a disk (model unavailable or
credits exhausted), that disk is left without a Summary and is picked up by the next run. The scan itself never
depends on the cron.

- Enable: open the Schedule page in Crew, find `exhume-crew/summarise-new-disks` and switch it on.
- Disable: switch it off on the same page. Disabling it stops further runs.
- The cron runs without approval prompts only because the tools it calls are in the auto-approve list (see A2).
  That list is `open_disk`, `read_grave`, `explain_state`, `list_disks`, `get_disk_card`, `save_disk_summary` and
  `add_disk_note`. `exhume` is never in it.

The exact Schedule page controls were not inspected (A8 covers the cron by hand).

## Accepted residual risks

- **Prompt injection from a disk.** Text on a disk reaches the models inside an `untrusted` envelope, and the agents
  have no tool that runs commands or reaches the network. A hostile disk can at worst make an agent read other
  disks in the library or write misleading capped text into a Summary or Note. It cannot write files, reach the
  network or leave the library. Summaries and Notes are capped (1,200 and 500 characters), stored as plain text and
  rendered literally. The only write tool, `exhume`, writes into `<library>/exhumed/` and always asks for approval.
  This follows the owner's auto-approve decision of 2026-11-11.
- **Signature replay window (v1).** The proxy signature the backend verifies (v1) has no nonce and is valid for
  60 seconds. The backend does not verify the nonce-bound v2 signature or the optional principal claim (V11). An
  on-host observer could replay a request within that minute, but would already need to read loopback traffic.
- **Local process access.** The backend listens on loopback. Every route except `/health` requires the HMAC
  signature, and the key is not known to other processes.
- **Weaker tool boundary if A1 fails.** If per-tool mounts do not work, the fallback mounts whole servers and the
  README must record the weaker boundary. This is not yet known.

## Credits

- [Exhume](https://github.com/tsang326/exhume) provides the pinned MCP server in `mcp/exhume-mcp.mjs` (see
  `mcp/PINNED.md` for the commit and SHA-256). All disk parsing is done by that server.
- [andete/disk-peek](https://github.com/andete/disk-peek) is prior art for browsing floppy disk images.
- Demo images: see `demo-library/NOTICE.md`.
