import { afterAll, beforeAll, describe, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, lstat, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../../src/shared/store";
import type { ExhumeClient, OpenDiskReport, ReadGraveResult } from "./exhume-client.js";
import { Scanner } from "./scanner";
import type { Timers } from "./scanner";

const NUM_RUNS = 100;
const noTimers: Timers = { setTimeout: () => 0, clearTimeout: () => undefined };

type Op = "scan" | "rescan" | "preview" | "exhumeAll";
const opArb = fc.constantFrom<Op>("scan", "rescan", "preview", "exhumeAll");

const dirArb = fc.constantFrom("", "d0", "d1", "d0/d2");
const fileArb = fc.record({
  dir: dirArb,
  name: fc.stringMatching(/^[a-z0-9]{1,5}$/),
  ext: fc.constantFrom(".img", ".ima", ".dsk", ".txt"),
  sectors: fc.integer({ min: 0, max: 3 }),
  fill: fc.integer({ min: 0, max: 255 }),
});
const filesArb = fc.uniqueArray(fileArb, {
  maxLength: 6,
  selector: (f) => `${f.dir}/${f.name}${f.ext}`.toLowerCase(),
});
const exhumedSeedArb = fc.uniqueArray(fc.stringMatching(/^[a-z0-9]{1,5}\.bin$/), { maxLength: 3 });
const scenarioArb = fc.record({
  files: filesArb,
  exhumedSeed: exhumedSeedArb,
  ops: fc.array(opArb, { minLength: 1, maxLength: 5 }),
});

interface Entry {
  readonly kind: "file" | "dir";
  readonly size: number;
  readonly mtimeMs: number;
  readonly digest: string;
}

/** Records every path in the library outside `exhumed/`, plus the set of paths inside it. */
async function snapshot(root: string): Promise<{ outside: Map<string, Entry>; inside: Set<string> }> {
  const outside = new Map<string, Entry>();
  const inside = new Set<string>();
  const stack: string[] = [""];
  for (let guard = 0; guard < 500 && stack.length > 0; guard++) {
    const rel = stack.pop() ?? "";
    const names = await readdir(path.join(root, rel));
    for (const name of names) {
      const childRel = rel === "" ? name : `${rel}/${name}`;
      const abs = path.join(root, childRel);
      const st = await lstat(abs);
      const isInside = childRel === "exhumed" || childRel.startsWith("exhumed/");
      if (isInside) inside.add(childRel);
      if (st.isDirectory()) {
        if (!isInside) outside.set(childRel, { kind: "dir", size: 0, mtimeMs: 0, digest: "" });
        stack.push(childRel);
      } else if (!isInside) {
        const digest = createHash("sha256")
          .update(await readFile(abs))
          .digest("hex");
        outside.set(childRel, { kind: "file", size: st.size, mtimeMs: st.mtimeMs, digest });
      }
    }
  }
  return { outside, inside };
}

function sameOutside(a: Map<string, Entry>, b: Map<string, Entry>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, va] of a) {
    const vb = b.get(key);
    if (vb === undefined) return false;
    if (va.kind !== vb.kind || va.size !== vb.size || va.mtimeMs !== vb.mtimeMs || va.digest !== vb.digest) {
      return false;
    }
  }
  return true;
}

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

/** Fake Exhume client; the only thing it ever writes is a file under `exhumed/`. */
class FakeClient implements ExhumeClient {
  calls = 0;
  constructor(private readonly root: string) {}
  openDisk(): Promise<OpenDiskReport> {
    this.calls++;
    return Promise.resolve(report());
  }
  readGrave(): Promise<ReadGraveResult> {
    this.calls++;
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
  async exhume(): Promise<never> {
    this.calls++;
    const dir = path.join(this.root, "exhumed", "disk");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `out${this.calls}.txt`), "exhumed");
    return undefined as never;
  }
  restart(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {}
}

let base = "";
let counter = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "crew-ro-prop-")));
});

afterAll(async () => {
  if (base !== "") await rm(base, { recursive: true, force: true });
});

describe("Scanner read-only behaviour", () => {
  // Feature: crew-app, Property 10: Scans and exhume-all leave the library unchanged
  // **Validates: Requirements 4.1, 4.2, 5.10**
  it("Feature: crew-app, Property 10: Scans and exhume-all leave the library unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        counter++;
        const work = path.join(base, `run${counter}`);
        const lib = path.join(work, "lib");
        try {
          await mkdir(path.join(lib, "exhumed"), { recursive: true });
          const old = new Date(Date.UTC(2001, 0, 1));
          for (const f of scenario.files) {
            const dirAbs = path.join(lib, f.dir);
            await mkdir(dirAbs, { recursive: true });
            const abs = path.join(dirAbs, `${f.name}${f.ext}`);
            await writeFile(abs, Buffer.alloc(f.sectors * 512, f.fill));
            await utimes(abs, old, old);
          }
          for (const name of scenario.exhumedSeed) {
            await writeFile(path.join(lib, "exhumed", name), "seed");
          }

          const before = await snapshot(lib);
          const client = new FakeClient(lib);
          const store = createStore(path.join(work, "data"));
          const scanner = new Scanner({ client, store, root: lib, timers: noTimers });

          for (const op of scenario.ops) {
            if (op === "scan" || op === "rescan") {
              scanner.triggerScan();
              await scanner.idle();
            } else if (op === "preview") {
              await client.readGrave();
            } else {
              await client.exhume();
            }
          }
          await scanner.idle();

          const after = await snapshot(lib);
          if (!sameOutside(before.outside, after.outside)) return false;
          // Seed paths inside exhumed/ are never removed; new paths appear only there.
          for (const p of before.inside) if (!after.inside.has(p)) return false;
          return true;
        } finally {
          await rm(work, { recursive: true, force: true });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);
});
