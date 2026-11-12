import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, it, vi } from "vitest";
import fc from "fast-check";
import type { CatalogueData, FilesDoc } from "./schema";
import { createStore, emptyCatalogue, listTempFiles } from "./store";

type Point = "open" | "write" | "partial-write" | "fsync" | "rename";

// Fixed list of failure points inside the temp file, fsync, rename sequence.
const POINTS: readonly Point[] = ["open", "write", "partial-write", "fsync", "rename"];

const inject = vi.hoisted(() => ({ point: null as string | null, hits: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const boom = (): never => {
    inject.hits++;
    throw Object.assign(new Error("injected failure"), { code: "EIO" });
  };
  const isTmp = (p: unknown): boolean => typeof p === "string" && p.endsWith(".tmp");
  return {
    ...actual,
    openSync: ((...args: Parameters<typeof actual.openSync>) => {
      if (inject.point === "open" && isTmp(args[0])) boom();
      return actual.openSync(...args);
    }) as typeof actual.openSync,
    writeFileSync: ((...args: Parameters<typeof actual.writeFileSync>) => {
      // Only the temp file is written through a file descriptor; the lock owner file uses a path.
      if (typeof args[0] === "number") {
        if (inject.point === "write") boom();
        if (inject.point === "partial-write") {
          const text = String(args[1]);
          actual.writeFileSync(args[0], text.slice(0, Math.max(1, Math.floor(text.length / 2))), "utf8");
          boom();
        }
      }
      return actual.writeFileSync(...args);
    }) as typeof actual.writeFileSync,
    fsyncSync: ((fd: number) => {
      if (inject.point === "fsync") boom();
      return actual.fsyncSync(fd);
    }) as typeof actual.fsyncSync,
    renameSync: ((from: string, to: string) => {
      if (inject.point === "rename" && isTmp(from)) boom();
      return actual.renameSync(from, to);
    }) as typeof actual.renameSync,
  };
});

const hex64 = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 })
  .map((a) => a.join(""));

const word = fc.string({ maxLength: 12 });

const catalogueArb: fc.Arbitrary<CatalogueData> = fc
  .array(fc.tuple(word, hex64, word), { maxLength: 6 })
  .map((rows) => {
    const data = emptyCatalogue();
    for (const [name, diskId, firstSeen] of rows) data.paths[`p/${name}`] = { diskId, firstSeen };
    return data;
  });

const filesDocArb: fc.Arbitrary<FilesDoc> = fc
  .tuple(hex64, fc.array(fc.tuple(word, fc.nat(100000)), { maxLength: 6 }), fc.boolean())
  .map(([diskId, rows, truncated]) => ({
    schemaVersion: 1 as const,
    diskId,
    totalEntries: rows.length,
    truncated,
    entries: rows.map(([path, size], id) => ({
      id,
      path,
      kind: "file" as const,
      state: "alive" as const,
      size,
      date: null,
    })),
  }));

function readRaw(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "store-failure-"));
  try {
    mkdirSync(dir, { recursive: true });
    return fn(dir);
  } finally {
    inject.point = null;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Feature: crew-app, Property 2: A failed write preserves the previous contents", () => {
  it("update() failing at any point leaves catalogue.json byte-identical and leaves no temp file or lock", () => {
    const prop = fc.property(fc.option(catalogueArb, { nil: null }), catalogueArb, (initial, next) => {
      return withTempDir((dir) => {
        const store = createStore(dir, { retryMs: 1, lockTimeoutMs: 50 });
        if (initial !== null && !store.update((d) => void Object.assign(d, initial)).ok) return false;
        const file = join(dir, "store", "catalogue.json");
        const before = readRaw(file);
        const beforeData = store.read();

        for (let i = 0; i < POINTS.length; i++) {
          inject.point = POINTS[i]!;
          inject.hits = 0;
          const r = store.update((d) => void Object.assign(d, next, { paths: next.paths }));
          inject.point = null;
          const failedCleanly = !r.ok && r.error.code === "STORE_WRITE_FAILED" && inject.hits > 0;
          const unchanged = readRaw(file) === before && isDeepStrictEqual(store.read(), beforeData);
          const noLeftovers = listTempFiles(dir).length === 0 && readRaw(join(dir, "store", ".lock", "owner.json")) === null;
          if (!failedCleanly || !unchanged || !noLeftovers) return false;
        }
        // The lock was released: a later write works.
        return store.update((d) => void Object.assign(d, next)).ok;
      });
    });
    fc.assert(prop, { numRuns: 100 });
  }, 60000);

  it("writeFiles() failing at any point leaves the previous files document intact and leaves no temp file or lock", () => {
    const prop = fc.property(fc.option(filesDocArb, { nil: null }), filesDocArb, (initial, next) => {
      return withTempDir((dir) => {
        const store = createStore(dir, { retryMs: 1, lockTimeoutMs: 50 });
        const diskId = next.diskId;
        const seeded = initial === null ? null : { ...initial, diskId };
        if (seeded !== null && !store.writeFiles(diskId, seeded).ok) return false;
        const file = join(dir, "store", "files", `${diskId}.json`);
        const before = readRaw(file);

        for (let i = 0; i < POINTS.length; i++) {
          inject.point = POINTS[i]!;
          inject.hits = 0;
          const r = store.writeFiles(diskId, next);
          inject.point = null;
          const failedCleanly = !r.ok && r.error.code === "STORE_WRITE_FAILED" && inject.hits > 0;
          const read = store.readFiles(diskId);
          const unchanged =
            readRaw(file) === before && read.ok && isDeepStrictEqual(read.value, seeded);
          const noLeftovers = listTempFiles(dir).length === 0 && readRaw(join(dir, "store", ".lock", "owner.json")) === null;
          if (!failedCleanly || !unchanged || !noLeftovers) return false;
        }
        return store.writeFiles(diskId, next).ok;
      });
    });
    fc.assert(prop, { numRuns: 100 });
  }, 60000);
});
