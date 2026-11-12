import { describe, it } from "vitest";
import fc from "fast-check";
import type { CatalogueData, DiskCard, FileEntry, FilesDoc } from "../../src/shared/schema";
import { emptyCatalogue } from "../../src/shared/store";
import type { Store } from "../../src/shared/store";
import type { ExhumeResult } from "./exhume-client";
import { createRoutes } from "./routes";
import type { RouteDeps, RouteResult } from "./routes";

// Feature: crew-app, Property 20: Exhume-all selects exactly the Recoverable_Entries and isolates failures
// **Validates: Requirements 7.9, 7.10**

const NUM_RUNS = 100;
const DISK_ID = "a".repeat(64);
const REL_PATH = "disk.img";

interface Spec {
  readonly kind: FileEntry["kind"];
  readonly state: FileEntry["state"];
  readonly succeeds: boolean;
}

const specArb: fc.Arbitrary<Spec[]> = fc.array(
  fc.record({
    kind: fc.constantFrom<FileEntry["kind"]>("file", "directory"),
    state: fc.constantFrom<FileEntry["state"]>("alive", "recovered", "partial", "lost"),
    succeeds: fc.boolean(),
  }),
  { maxLength: 30 },
);

function makeCard(): DiskCard {
  return {
    diskId: DISK_ID,
    relPath: REL_PATH,
    label: "DISK",
    sizeBytes: 512,
    geometry: { source: "bpb", label: null },
    fileCount: 0,
    totalEntries: 0,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: [],
    counts: { alive: 0, recovered: 0, partial: 0, lost: 0 },
    warnings: [],
    status: "catalogued",
    firstSeen: "2024-01-01T00:00:00.000Z",
  };
}

function makeStore(entries: FileEntry[]): Store {
  const data: CatalogueData = emptyCatalogue();
  data.cards[DISK_ID] = makeCard();
  const doc: FilesDoc = {
    schemaVersion: 1,
    diskId: DISK_ID,
    totalEntries: entries.length,
    truncated: false,
    entries,
  };
  return {
    read: () => ({ ok: true, value: data }),
    update: (mutate) => {
      mutate(data);
      return { ok: true, value: undefined };
    },
    readFiles: () => ({ ok: true, value: doc }),
    writeFiles: () => ({ ok: true, value: undefined }),
  };
}

interface Outcome {
  readonly calls: number[];
  readonly results: unknown[];
  readonly status: number;
}

async function run(specs: readonly Spec[]): Promise<Outcome> {
  const entries: FileEntry[] = specs.map((s, i) => ({
    id: i + 1,
    path: `F${i + 1}.TXT`,
    kind: s.kind,
    state: s.state,
    size: 1,
    date: null,
  }));
  const calls: number[] = [];
  const exhume = (_image: string, _path: string, id: number): Promise<ExhumeResult> => {
    calls.push(id);
    if (specs[id - 1]?.succeeds !== true) return Promise.reject(new Error("fake failure"));
    return Promise.resolve({ path: `exhumed/F${id}.TXT` } as unknown as ExhumeResult);
  };
  const deps: RouteDeps = {
    store: makeStore(entries),
    scanner: {
      getStatus: () => ({ state: "idle" }) as never,
      triggerScan: () => ({ started: true, running: true }),
    },
    library: {
      getStatus: () => ({ path: "/lib", error: null }) as never,
      getRealPath: () => "/lib",
      setLibrary: () => Promise.reject(new Error("unused")),
    },
    exhume: { readGrave: () => Promise.reject(new Error("unused")), exhume },
    copyDemo: () => Promise.reject(new Error("unused")),
    hashImage: () => Promise.resolve(DISK_ID),
    clock: { now: () => Date.UTC(2024, 0, 1) },
  };
  const route = createRoutes(deps).find((r) => r.pattern.includes("exhume-all"));
  if (route === undefined) throw new Error("route missing");
  const res: RouteResult = await route.handler({
    params: { id: DISK_ID },
    query: {},
    body: new Uint8Array(),
  });
  const body = res.body as { results?: unknown[] };
  return { calls, results: body.results ?? [], status: res.status };
}

describe("Property 20: exhume-all selects exactly the Recoverable_Entries and isolates failures", () => {
  it("attempts each recoverable entry once, in order, and reports each outcome", async () => {
    const holds = await fc.asyncProperty(specArb, async (specs) => {
      const expected: number[] = [];
      specs.forEach((s, i) => {
        if (s.kind === "file" && (s.state === "alive" || s.state === "recovered")) expected.push(i + 1);
      });
      const out = await run(specs);
      if (out.status !== 200) return false;
      if (JSON.stringify(out.calls) !== JSON.stringify(expected)) return false;
      if (out.results.length !== expected.length) return false;
      return out.results.every((r, i) => {
        const item = r as { entry: number; outcome: string };
        const id = expected[i] ?? -1;
        const want = specs[id - 1]?.succeeds === true ? "exhumed" : "failed";
        return item.entry === id && item.outcome === want;
      });
    });
    await fc.assert(holds, { numRuns: NUM_RUNS });
  });
});
