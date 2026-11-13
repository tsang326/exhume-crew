/**
 * Backend entry point. Wires Store, LibraryManager, StdioExhumeClient, Scanner,
 * the watcher and the HTTP server, and shuts them down on SIGTERM / SIGINT.
 *
 * Environment: PORT (required), KIROCREW_PROXY_SECRET (empty means every Page_API
 * request is refused), KIROCREW_HOME and KIROCREW_APP_NAME (only cross-checked).
 * The app root comes from the real path of this file, so a relocated
 * KIROCREW_HOME still works; app state lives in `<appRoot>/data`
 * (normally ~/.kiro/crew/apps/exhume-crew/data).
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNodeVersion } from "../../src/shared/version";
import { createStore } from "../../src/shared/store";
import { copyDemoLibrary } from "./demo";
import { StdioExhumeClient } from "./exhume-client";
import { LibraryManager } from "./library";
import { createRoutes } from "./routes";
import type { ScannerPort } from "./routes";
import { Scanner, hashCandidate } from "./scanner";
import { createApiServer, listen } from "./server";

const APP_VERSION = "0.1.0";
const APP_NAME = "exhume-crew";
const MAX_ROOT_SEARCH_LEVELS = 4;
const SHUTDOWN_GRACE_MS = 2000;

function fail(message: string): never {
  process.stderr.write(`exhume-crew backend: ${message}\n`);
  process.exit(1);
}

/** Finds the app root: the nearest folder above this file that holds the pinned Exhume bundle. */
function findAppRoot(): string {
  let dir = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
  for (let i = 0; i < MAX_ROOT_SEARCH_LEVELS; i++) {
    if (existsSync(path.join(dir, "mcp", "exhume-mcp.mjs"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fail("cannot locate the app folder (mcp/exhume-mcp.mjs not found).");
}

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^[0-9]{1,5}$/.test(value)) return fail("PORT is not set to a valid port.");
  const port = Number(value);
  if (port < 1 || port > 65535) return fail("PORT is not set to a valid port.");
  return port;
}

/** Warns when the derived app root disagrees with KIROCREW_HOME / KIROCREW_APP_NAME. */
function warnIfRootDisagrees(appRoot: string): void {
  const home = process.env["KIROCREW_HOME"];
  const name = process.env["KIROCREW_APP_NAME"];
  if (home === undefined || name === undefined) return;
  try {
    const expected = realpathSync(path.join(home, "apps", name));
    if (expected !== appRoot) {
      process.stderr.write("exhume-crew backend: warning: app folder differs from KIROCREW_HOME.\n");
    }
  } catch {
    process.stderr.write("exhume-crew backend: warning: KIROCREW_HOME app folder could not be checked.\n");
  }
}

async function main(): Promise<void> {
  const version = checkNodeVersion(process.version);
  if (!version.ok) fail(version.message);

  const port = parsePort(process.env["PORT"]);
  const secret = process.env["KIROCREW_PROXY_SECRET"];
  if (secret === undefined || secret === "") {
    process.stderr.write("exhume-crew backend: warning: no proxy secret; every API request will be refused.\n");
  }

  const appRoot = findAppRoot();
  warnIfRootDisagrees(appRoot);
  const dataDir = path.join(appRoot, "data");
  const home = homedir();

  const store = createStore(dataDir);

  // The scanner exists only once a valid library does; the client starts lazily.
  let scanner: Scanner | null = null;
  const client = new StdioExhumeClient({
    appRoot,
    libraryRoot: path.join(dataDir, "no-library"),
    version: APP_VERSION,
  });

  const ensureScanner = (root: string): Scanner => {
    if (scanner === null) {
      scanner = new Scanner({ client, store, root });
      scanner.startWatching();
    } else {
      scanner.setRoot(root);
    }
    return scanner;
  };

  const library = new LibraryManager({
    dataDir,
    home,
    restartExhume: async (real) => {
      await client.restart(real);
      ensureScanner(real);
    },
    triggerScan: () => {
      scanner?.triggerScan();
    },
  });

  const status = await library.init();
  const initialRoot = library.getRealPath();
  if (initialRoot !== null) {
    await client.restart(initialRoot);
    ensureScanner(initialRoot).start();
  } else {
    process.stderr.write(`exhume-crew backend: no usable library (${status.error?.code ?? "none"}).\n`);
  }

  const scannerPort: ScannerPort = {
    getStatus: () =>
      scanner?.getStatus() ?? {
        state: "idle",
        scanned: 0,
        total: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        libraryWarnings: [],
      },
    triggerScan: () => scanner?.triggerScan() ?? { started: false, running: false },
  };

  const routes = createRoutes({
    store,
    scanner: scannerPort,
    library,
    exhume: client,
    copyDemo: (typedPath) => {
      const expanded =
        typedPath === "~" ? home : typedPath.startsWith("~/") ? path.join(home, typedPath.slice(2)) : typedPath;
      return copyDemoLibrary(appRoot, expanded, { userInitiated: true, home });
    },
    hashImage: async (relPath, sizeBytes) => {
      const root = library.getRealPath();
      if (root === null) return null;
      const outcome = await hashCandidate(root, { relPath, size: sizeBytes, mtimeMs: 0 });
      return outcome.ok ? outcome.image.sha256 : null;
    },
    clock: { now: () => Date.now() },
  });

  const server = createApiServer({ secret, routes });
  await listen(server, port);
  process.stderr.write(`exhume-crew backend: listening on 127.0.0.1:${port}\n`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    timer.unref();
    (scanner as Scanner | null)?.stop();
    client.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

process.on("unhandledRejection", () => {
  process.stderr.write("exhume-crew backend: an unexpected error was ignored.\n");
});

main().catch(() => {
  fail(`could not start (${APP_NAME}).`);
});
