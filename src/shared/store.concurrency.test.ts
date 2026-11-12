/**
 * Concurrent-writer integration test for the Store.
 *
 * Three child processes append notes through the real Store at the same time.
 * The Store is bundled with esbuild into a temp directory so plain node can run
 * it. Every child has a hard timeout and is killed with SIGKILL.
 *
 * Validates: Requirements 6.4, 6.5
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStore } from "./store";

const HERE = dirname(fileURLToPath(import.meta.url));
const DISK_ID = "a".repeat(64);
const CHILDREN = 3;
const NOTES_PER_CHILD = 10; // 30 total, under the 100 note cap
const CHILD_TIMEOUT_MS = 60_000;

let work = "";
let bundle = "";
let childScript = "";

const CHILD_SOURCE = `
import { createStore } from ${"__BUNDLE__"};
const [dataDir, tag, countText] = process.argv.slice(2);
const count = Number(countText);
const store = createStore(dataDir);
let failures = 0;
for (let i = 0; i < count; i++) {
  const r = store.update((d) => {
    const a = d.annotations[${"__DISK__"}] ?? { summary: null, notes: [] };
    a.notes.push({ id: tag + "-" + i, text: "note " + tag + " " + i, savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-archivist" });
    d.annotations[${"__DISK__"}] = a;
  });
  if (!r.ok) failures++;
}
process.exit(failures === 0 ? 0 : 3);
`;

function runChild(dataDir: string, tag: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [childScript, dataDir, tag, String(NOTES_PER_CHILD)], {
      stdio: "ignore",
      timeout: CHILD_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), CHILD_TIMEOUT_MS + 1000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "exhume-store-conc-"));
  bundle = join(work, "store.bundle.mjs");
  buildSync({
    entryPoints: [join(HERE, "store.ts")],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  childScript = join(work, "child.mjs");
  writeFileSync(
    childScript,
    CHILD_SOURCE.replace("__BUNDLE__", JSON.stringify(bundle)).replaceAll("__DISK__", JSON.stringify(DISK_ID)),
  );
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("Store concurrency", () => {
  it("keeps every note appended by three simultaneous child processes", async () => {
    const dataDir = join(work, "data-concurrent");
    mkdirSync(dataDir, { recursive: true });

    const tags = ["p0", "p1", "p2"].slice(0, CHILDREN);
    const codes = await Promise.all(tags.map((t) => runChild(dataDir, t)));
    expect(codes).toEqual(tags.map(() => 0));

    const read = createStore(dataDir).read();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const ids = (read.value.annotations[DISK_ID]?.notes ?? []).map((n) => n.id).sort();
    const expected: string[] = [];
    for (const t of tags) for (let i = 0; i < NOTES_PER_CHILD; i++) expected.push(`${t}-${i}`);
    expect(ids).toEqual(expected.sort());
  }, 90_000);

  it("returns STORE_BUSY after about 5 s when the lock is held by a live process", () => {
    const dataDir = join(work, "data-busy");
    const lockDir = join(dataDir, "store", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

    const started = Date.now();
    const result = createStore(dataDir).update((d) => {
      d.cards = d.cards; // never reached while the lock is held
    });
    const elapsed = Date.now() - started;

    expect(result).toEqual({ ok: false, error: { code: "STORE_BUSY" } });
    expect(elapsed).toBeGreaterThanOrEqual(4800);
    expect(elapsed).toBeLessThan(8000);
    // The data is unchanged: no catalogue file was written.
    expect(createStore(dataDir).read()).toEqual({
      ok: true,
      value: { schemaVersion: 1, paths: {}, cards: {}, annotations: {}, exhumed: {} },
    });
  }, 20_000);
});
