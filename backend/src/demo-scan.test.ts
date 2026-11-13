/**
 * Demo library scan (Requirements 18.1-18.6, 19.2).
 *
 * Runs the real Scanner and StdioExhumeClient against the real pinned
 * server and the shipped `demo-library/`. The library is only read; the
 * unreadable/missing case uses a temporary copy. Set
 * `WRITE_DEMO_GOLDEN=1` to regenerate the golden file.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../../src/shared/store";
import type { DiskCard } from "../../src/shared/schema";
import { buildImage } from "../../scripts/make-harbor-note.mjs";
import { StdioExhumeClient } from "./exhume-client.js";
import { Scanner } from "./scanner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const demoLibrary = path.join(appRoot, "demo-library");
const goldenPath = path.join(here, "..", "test-fixtures", "demo-golden.json");

const SCAN_LIMIT_MS = 10_000;
const IDLE_ROUNDS_CAP = 400; // x 50 ms = 20 s hard cap

const tempDirs: string[] = [];
const clients: StdioExhumeClient[] = [];

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  for (const d of tempDirs.splice(0)) {
    try {
      chmodRecursiveWritable(d);
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  vi.restoreAllMocks();
});

function chmodRecursiveWritable(dir: string): void {
  for (const name of readdirSync(dir).slice(0, 100)) {
    try {
      chmodSync(path.join(dir, name), 0o644);
    } catch {
      // ignore
    }
  }
}

function makeTemp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

interface ScanOutcome {
  cards: DiskCard[];
  elapsedMs: number;
  state: string;
}

async function scanLibrary(libraryRoot: string): Promise<ScanOutcome> {
  const root = realpathSync(libraryRoot);
  const dataDir = makeTemp("exhume-demo-data-");
  const store = createStore(dataDir);
  const client = new StdioExhumeClient({ appRoot, libraryRoot: root });
  clients.push(client);
  const scanner = new Scanner({ client, store, root });
  const started = Date.now();
  scanner.triggerScan();
  for (let i = 0; i < IDLE_ROUNDS_CAP; i++) {
    if (scanner.getStatus().state !== "running") break;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  await scanner.idle();
  const elapsedMs = Date.now() - started;
  const read = store.read();
  if (!read.ok) throw new Error("store read failed");
  const cards = Object.values(read.value.cards).sort((a, b) => a.relPath.localeCompare(b.relPath));
  client.close();
  return { cards, elapsedMs, state: scanner.getStatus().state };
}

/** Drops scan times; relPath is already relative and carries no absolute path. */
function normalise(cards: readonly DiskCard[]): Omit<DiskCard, "firstSeen">[] {
  return cards.map((card) => {
    const { firstSeen: _firstSeen, ...rest } = card;
    return rest;
  });
}

describe("demo library scan", () => {
  it("yields exactly five cards equal to the golden file within 10 s, with no network", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network use is not allowed");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const outcome = await scanLibrary(demoLibrary);
      expect(outcome.state).toBe("idle");
      expect(outcome.elapsedMs).toBeLessThan(SCAN_LIMIT_MS);
      expect(outcome.cards).toHaveLength(5);
      expect(fetchSpy).not.toHaveBeenCalled();

      const actual = normalise(outcome.cards);
      if (process.env["WRITE_DEMO_GOLDEN"] === "1") {
        writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
      }
      const golden: unknown = JSON.parse(readFileSync(goldenPath, "utf8"));
      expect(Array.isArray(golden)).toBe(true);
      expect(golden).toHaveLength(5);
      expect(JSON.parse(JSON.stringify(actual))).toEqual(golden);
      // No absolute path or scan time leaks into the golden file.
      const text = readFileSync(goldenPath, "utf8");
      expect(text).not.toContain(appRoot);
      expect(text).not.toContain("firstSeen");
    } finally {
      vi.unstubAllGlobals();
    }
  }, 60_000);

  it("still returns cards for the other images when one is unreadable or missing", async () => {
    const copy = makeTemp("exhume-demo-copy-");
    const names = readdirSync(demoLibrary)
      .filter((n) => n.endsWith(".img"))
      .slice(0, 16);
    expect(names).toHaveLength(5);
    for (const n of names) copyFileSync(path.join(demoLibrary, n), path.join(copy, n));

    // A dangling link stands in for an image that went missing after listing.
    symlinkSync(path.join(copy, "gone.img"), path.join(copy, "missing.img"));

    // An unreadable image (not enforceable when running as root).
    const unreadable = "damaged-disk.img";
    const canBlock = typeof process.getuid === "function" && process.getuid() !== 0;
    if (canBlock) chmodSync(path.join(copy, unreadable), 0o000);

    const outcome = await scanLibrary(copy);
    expect(outcome.state).toBe("idle");
    const paths = outcome.cards.map((c) => c.relPath);
    const expected = names.filter((n) => !(canBlock && n === unreadable));
    for (const n of expected) expect(paths).toContain(n);
    expect(paths).not.toContain("missing.img");
    expect(outcome.cards.length).toBeGreaterThanOrEqual(expected.length);
  }, 60_000);

  it("keeps the FreeDOS image identical to the SHA-256 recorded in NOTICE.md", () => {
    const notice = readFileSync(path.join(demoLibrary, "NOTICE.md"), "utf8");
    const match = /Image SHA-256:\s*`([0-9a-f]{64})`/.exec(notice);
    expect(match).not.toBeNull();
    const actual = createHash("sha256")
      .update(readFileSync(path.join(demoLibrary, "fd13-720k-dsk01.img")))
      .digest("hex");
    expect(actual).toBe(match?.[1]);
  });

  it("keeps harbor-note.img byte-identical to the generator output and to NOTICE.md", () => {
    const committed = readFileSync(path.join(demoLibrary, "harbor-note.img"));
    expect(Buffer.compare(buildImage(), committed)).toBe(0);
    const notice = readFileSync(path.join(demoLibrary, "NOTICE.md"), "utf8");
    const match = /harbor-note\.img SHA-256:\s*`([0-9a-f]{64})`/.exec(notice);
    expect(match?.[1]).toBe(createHash("sha256").update(committed).digest("hex"));
  });

  it("reads every file of harbor-note.img through the real pinned server", async () => {
    const client = new StdioExhumeClient({
      appRoot,
      libraryRoot: demoLibrary,
      timeouts: { handshake: 10_000, open_disk: 20_000, read_grave: 10_000 },
    });
    clients.push(client);
    const report = await client.openDisk("harbor-note.img");
    const names = report.entries.filter((e) => e.kind === "file").map((e) => e.path.toUpperCase());
    for (const n of ["README.TXT", "TIMES.TXT", "NOTE.TXT"]) expect(names.some((p) => p.endsWith(n))).toBe(true);
    for (const e of report.entries.filter((x) => x.kind === "file")) {
      const grave = await client.readGrave("harbor-note.img", e.path, e.id);
      expect(grave.grave.id).toBe(e.id);
    }
    client.close();
  }, 60_000);
});
