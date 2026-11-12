import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { createStore, emptyCatalogue } from "./store";
import type {
  Annotation,
  CardWarning,
  CatalogueData,
  DiskCard,
  FileEntry,
  FilesDoc,
  Note,
} from "./schema";

const wf = (s: string): string => (s as unknown as { toWellFormed(): string }).toWellFormed();

/** Deep well-formed copy: what the Store promises to hand back for lone surrogates. */
function expectedOf(value: unknown): unknown {
  if (typeof value === "string") return wf(value);
  if (Array.isArray(value)) return value.map(expectedOf);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [wf(k), expectedOf(v)]));
  }
  return value;
}

// ------------------------------------------------------------- generators

const HEX = "0123456789abcdef".split("");
const diskId = fc.array(fc.constantFrom(...HEX), { minLength: 64, maxLength: 64 }).map((a) => a.join(""));

// Any UTF-16 code unit (lone surrogates included), markup and control characters.
const anyUnit = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }).map((n) => String.fromCharCode(n)),
  fc.constantFrom("<", ">", "&", '"', "'", "\u0000", "\u0007", "\u007f", "\u0085", "\u2028", "\u202e", "\ufeff", "😀"),
  fc.string({ unit: "binary", minLength: 1, maxLength: 3 }),
);
const text = (maxLength = 30) => fc.string({ unit: anyUnit, maxLength });
// Keys must stay distinct after well-forming, so they are well-formed already.
const key = fc.string({ unit: "binary", minLength: 1, maxLength: 20 }).map(wf).filter((k) => k !== "__proto__");

const count = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const agent = fc.constantFrom("exhume-archivist" as const, "exhume-undertaker" as const);
const nullableText = fc.option(text(), { nil: null });

const warning: fc.Arbitrary<CardWarning> = fc.record(
  { code: text(), message: text(), path: text() },
  { requiredKeys: ["code", "message"] },
);

const card = (id: string): fc.Arbitrary<DiskCard> =>
  fc.record({
    diskId: fc.constant(id),
    relPath: text(60),
    label: text(60),
    sizeBytes: count,
    geometry: fc.record({
      source: fc.constantFrom("bpb" as const, "fallback" as const, "none" as const),
      label: nullableText,
    }),
    fileCount: count,
    totalEntries: count,
    entriesTruncated: fc.boolean(),
    dateFirst: nullableText,
    dateLast: nullableText,
    formats: fc.subarray(["markdown", "csv", "png", "text"] as const),
    counts: fc.record({ alive: count, recovered: count, partial: count, lost: count }),
    warnings: fc.array(warning, { maxLength: 5 }),
    status: fc.constantFrom("new" as const, "catalogued" as const, "summarised" as const),
    firstSeen: text(),
  });

const note: fc.Arbitrary<Note> = fc.record({
  id: text(),
  text: text(),
  savedAt: text(),
  agent,
});

const annotation: fc.Arbitrary<Annotation> = fc.record({
  summary: fc.option(fc.record({ text: text(), savedAt: text(), agent }), { nil: null }),
  notes: fc.array(note, { maxLength: 4 }),
});

const catalogue: fc.Arbitrary<CatalogueData> = fc
  .uniqueArray(diskId, { maxLength: 4 })
  .chain((ids) =>
    fc.record({
      schemaVersion: fc.constant(1 as const),
      paths: fc
        .uniqueArray(fc.tuple(key, fc.constantFrom(...(ids.length ? ids : ["0".repeat(64)])), text()), {
          maxLength: 4,
          selector: ([k]) => k,
        })
        .map((rows) => Object.fromEntries(rows.map(([k, id, firstSeen]) => [k, { diskId: id, firstSeen }]))),
      cards: fc
        .tuple(...ids.map(card))
        .map((cs) => Object.fromEntries(cs.map((c) => [c.diskId, c]))),
      annotations: fc
        .tuple(...ids.map(() => fc.option(annotation, { nil: undefined })))
        .map((as) =>
          Object.fromEntries(ids.flatMap((id, i) => (as[i] === undefined ? [] : [[id, as[i]]]))),
        ),
      exhumed: fc
        .tuple(
          ...ids.map(() =>
            fc.uniqueArray(fc.tuple(key, text(), text()), { maxLength: 3, selector: ([k]) => k }),
          ),
        )
        .map((rows) =>
          Object.fromEntries(
            ids.flatMap((id, i) =>
              rows[i]!.length === 0
                ? []
                : [[id, Object.fromEntries(rows[i]!.map(([k, outputPath, at]) => [k, { outputPath, at }]))]],
            ),
          ),
        ),
    }),
  ) as fc.Arbitrary<CatalogueData>;

const fileEntry: fc.Arbitrary<FileEntry> = fc.record(
  {
    id: count,
    path: text(60),
    kind: fc.constantFrom("file" as const, "directory" as const),
    state: fc.constantFrom("alive" as const, "recovered" as const, "partial" as const, "lost" as const),
    size: count,
    date: nullableText,
    reason: text(),
  },
  { requiredKeys: ["id", "path", "kind", "state", "size", "date"] },
);

const filesDoc: fc.Arbitrary<{ id: string; doc: FilesDoc }> = diskId.chain((id) =>
  fc
    .record({
      schemaVersion: fc.constant(1 as const),
      diskId: fc.constant(id),
      totalEntries: count,
      truncated: fc.boolean(),
      entries: fc.array(fileEntry, { maxLength: 6 }),
    })
    .map((doc) => ({ id, doc })),
);

// ------------------------------------------------------------------ tests

function inTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "store-roundtrip-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Key-order independent deep equality (no expect in callbacks).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (!same(ka, kb)) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

describe("Feature: crew-app, Property 1: Store round trip", () => {
  it("returns the catalogue contents that were written, with strings made well-formed", () => {
    fc.assert(
      fc.property(catalogue, (data) =>
        inTempDir((dir) => {
          const store = createStore(dir);
          const w = store.update((draft) => {
            Object.assign(draft, data);
          });
          const r = store.read();
          const r2 = createStore(dir).read(); // a fresh instance sees the same thing
          return (
            w.ok &&
            r.ok &&
            r2.ok &&
            deepEqual(r.value, expectedOf(data)) &&
            deepEqual(r2.value, expectedOf(data))
          );
        }),
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  it("returns exactly what was written when every string is already well-formed", () => {
    fc.assert(
      fc.property(catalogue, (data) => {
        const clean = expectedOf(data) as CatalogueData;
        return inTempDir((dir) => {
          const store = createStore(dir);
          const w = store.update((draft) => {
            Object.assign(draft, clean);
          });
          const r = store.read();
          return w.ok && r.ok && deepEqual(r.value, clean);
        });
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it("round-trips a files document through writeFiles and readFiles", () => {
    fc.assert(
      fc.property(filesDoc, ({ id, doc }) =>
        inTempDir((dir) => {
          const store = createStore(dir);
          const w = store.writeFiles(id, doc);
          const r = store.readFiles(id);
          return w.ok && r.ok && deepEqual(r.value, expectedOf(doc));
        }),
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("reads an empty catalogue from a fresh directory", () => {
    inTempDir((dir) => {
      const r = createStore(dir).read();
      if (!r.ok || !deepEqual(r.value, emptyCatalogue())) throw new Error("fresh store was not empty");
    });
  });
});
