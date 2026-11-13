import { describe, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../../src/shared/store";
import type { CatalogueData } from "../../src/shared/schema";
import type { ExhumeClient, OpenDiskReport, ReadGraveResult } from "./exhume-client.js";
import { Scanner } from "./scanner";
import type { Timers } from "./scanner";

const NUM_RUNS = 100;

function report(): OpenDiskReport {
  return {
    untrusted: true,
    volume: { label: "DISK", geometrySource: "bpb" },
    totalEntries: 1,
    counts: { alive: 1, recovered: 0, partial: 0, lost: 0 },
    entries: [{ id: 1, path: "A.TXT", kind: "file", state: "alive", size: 3, date: "1990-01-01T00:00:00" }],
    truncated: false,
    warnings: [],
    warningsOmitted: 0,
  };
}

/** In-memory fake of the Exhume client that records every open_disk call. */
class FakeClient implements ExhumeClient {
  opens: string[] = [];
  openDisk(image: string): Promise<OpenDiskReport> {
    this.opens.push(image);
    return Promise.resolve(report());
  }
  readGrave(): Promise<ReadGraveResult> {
    return Promise.resolve({
      grave: { id: 1, path: "A.TXT", state: "alive" },
      format: "text",
      mime: "text/plain",
      extension: "txt",
      text: "x",
      totalChars: 1,
      truncated: false,
      warnings: [],
      warningsOmitted: 0,
    } as unknown as ReadGraveResult);
  }
  exhume(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  restart(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {}
}

const noTimers: Timers = { setTimeout: () => 0, clearTimeout: () => undefined };

/** Content of an image is 512 bytes filled with one byte value, so the value picks the Disk_Id. */
function content(value: number): Buffer {
  return Buffer.alloc(512, value);
}
function diskIdOf(value: number): string {
  return createHash("sha256").update(content(value)).digest("hex");
}

interface Scenario {
  /** Initial content value per path (all distinct, 1..100). */
  readonly initial: readonly number[];
  /** Whether each initial path is changed before the third scan. */
  readonly changed: readonly boolean[];
  /** Number of images added before the third scan. */
  readonly added: number;
}

const scenario: fc.Arbitrary<Scenario> = fc
  .integer({ min: 1, max: 5 })
  .chain((n) =>
    fc.record({
      initial: fc.uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: n, maxLength: n }),
      changed: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      added: fc.integer({ min: 0, max: 3 }),
    }),
  );

function read(store: ReturnType<typeof createStore>): CatalogueData | null {
  const r = store.read();
  return r.ok ? r.value : null;
}

/** Runs the scenario in a fresh temp dir; returns true when every claim of Property 11 holds. */
async function holds(s: Scenario): Promise<boolean> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "crew-rescan-prop-")));
  try {
    const lib = path.join(dir, "lib");
    await mkdir(path.join(lib, "exhumed"), { recursive: true });
    const nameOf = (i: number): string => `disk${i}.img`;
    for (let i = 0; i < s.initial.length; i++) {
      await writeFile(path.join(lib, nameOf(i)), content(s.initial[i] ?? 0));
    }

    let tick = Date.UTC(2024, 0, 1);
    const clock = { now: (): number => (tick += 1000) };
    const client = new FakeClient();
    const store = createStore(path.join(dir, "data"));
    const scanner = new Scanner({ client, store, root: lib, timers: noTimers, clock });

    scanner.triggerScan();
    await scanner.idle();
    const first = read(store);
    if (first === null || client.opens.length !== s.initial.length) return false;

    // Second scan with no changes: zero open_disk calls, catalogue unchanged.
    scanner.triggerScan();
    await scanner.idle();
    const second = read(store);
    if (second === null || client.opens.length !== s.initial.length) return false;
    if (JSON.stringify(second.cards) !== JSON.stringify(first.cards)) return false;
    if (JSON.stringify(second.paths) !== JSON.stringify(first.paths)) return false;

    // Change some images (fresh Disk_Id) and add new ones (fresh Disk_Id).
    let fresh = 101;
    const changedIdx: number[] = [];
    const unchangedIdx: number[] = [];
    const newIds = new Map<number, string>();
    for (let i = 0; i < s.initial.length; i++) {
      if (s.changed[i] === true) {
        const v = fresh++;
        await writeFile(path.join(lib, nameOf(i)), content(v));
        newIds.set(i, diskIdOf(v));
        changedIdx.push(i);
      } else {
        unchangedIdx.push(i);
      }
    }
    const addedIds: string[] = [];
    for (let k = 0; k < s.added; k++) {
      const v = fresh++;
      await writeFile(path.join(lib, `added${k}.img`), content(v));
      addedIds.push(diskIdOf(v));
    }

    const before = client.opens.length;
    scanner.triggerScan();
    await scanner.idle();
    const third = read(store);
    if (third === null) return false;

    const expectedNew = changedIdx.length + s.added;
    if (client.opens.length - before !== expectedNew) return false;

    for (const i of changedIdx) {
      const rel = nameOf(i);
      const newId = newIds.get(i);
      const oldId = diskIdOf(s.initial[i] ?? 0);
      const rec = third.paths[rel];
      const originalSeen = first.paths[rel]?.firstSeen;
      if (newId === undefined || rec === undefined || originalSeen === undefined) return false;
      if (rec.diskId !== newId || rec.firstSeen !== originalSeen) return false;
      if (third.cards[newId] === undefined || third.cards[newId]?.firstSeen !== originalSeen) return false;
      if (third.cards[oldId] !== undefined) return false;
    }
    for (const id of addedIds) {
      if (third.cards[id] === undefined) return false;
    }
    for (const i of unchangedIdx) {
      const id = diskIdOf(s.initial[i] ?? 0);
      const rel = nameOf(i);
      if (JSON.stringify(third.cards[id]) !== JSON.stringify(first.cards[id])) return false;
      if (JSON.stringify(third.paths[rel]) !== JSON.stringify(first.paths[rel])) return false;
    }
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Scanner rescan", () => {
  it(
    "Feature: crew-app, Property 11: Rescan idempotence and change detection",
    async () => {
      // **Validates: Requirements 5.3, 5.4, 19.3**
      await fc.assert(fc.asyncProperty(scenario, (s) => holds(s)), { numRuns: NUM_RUNS });
    },
    120_000,
  );
});
