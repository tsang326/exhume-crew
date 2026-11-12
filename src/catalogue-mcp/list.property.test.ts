import { describe, it } from "vitest";
import fc from "fast-check";
import type { Annotation, DiskCard } from "../shared/schema";
import { emptyCatalogue, type Store } from "../shared/store";
import { callTool, MAX_LIST_DISKS, MAX_RESPONSE_CHARS, NOTICE } from "./tools";

type Kind = "none" | "summary" | "big";

function idOf(n: number): string {
  return n.toString(16).padStart(4, "0").repeat(16);
}

function makeCard(diskId: string): DiskCard {
  return {
    diskId,
    relPath: "a.img",
    label: "LABEL",
    sizeBytes: 1,
    geometry: { source: "none", label: null },
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

function makeAnnotation(kind: Kind): Annotation | undefined {
  if (kind === "none") return undefined;
  const savedAt = "2024-01-02T00:00:00.000Z";
  const agent = "exhume-archivist" as const;
  const summary = { text: "summary", savedAt, agent };
  if (kind === "summary") return { summary, notes: [] };
  // About 50 KB of notes: a handful of these exceed the response cap.
  const notes = Array.from({ length: 100 }, (_, i) => ({
    id: `n${i}`,
    text: "x".repeat(500),
    savedAt,
    agent,
  }));
  return { summary, notes };
}

/** In-memory Store: no files, nothing to clean up. Only `read` is used by list_disks. */
function memoryStore(entries: readonly { n: number; kind: Kind }[]): Store {
  const data = emptyCatalogue();
  for (const { n, kind } of entries) {
    const id = idOf(n);
    data.cards[id] = makeCard(id);
    const annotation = makeAnnotation(kind);
    if (annotation !== undefined) data.annotations[id] = annotation;
  }
  return {
    read: () => ({ ok: true, value: data }),
    update: () => ({ ok: true, value: undefined }),
    readFiles: () => ({ ok: true, value: null }),
    writeFiles: () => ({ ok: true, value: undefined }),
  };
}

interface ListBody {
  untrusted?: unknown;
  notice?: unknown;
  total?: unknown;
  truncated?: unknown;
  nextAfter?: unknown;
  disks?: { diskId: string; summary: unknown }[];
}

const kindArb = fc.constantFrom<Kind>("none", "summary", "big");

// Mostly small catalogues, sometimes past the 200 cap, sometimes with oversized annotations.
const entriesArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .uniqueArray(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
      .chain((ns) =>
        fc.tuple(...ns.map((n) => fc.record({ n: fc.constant(n), kind: fc.constantFrom<Kind>("none", "summary") }))),
      ),
  },
  {
    weight: 2,
    arbitrary: fc
      .uniqueArray(fc.integer({ min: 0, max: 0xffff }), { minLength: 195, maxLength: 230 })
      .chain((ns) =>
        fc.tuple(...ns.map((n) => fc.record({ n: fc.constant(n), kind: fc.constantFrom<Kind>("none", "summary") }))),
      ),
  },
  {
    weight: 2,
    arbitrary: fc
      .uniqueArray(fc.integer({ min: 0, max: 0xffff }), { minLength: 8, maxLength: 30 })
      .chain((ns) => fc.tuple(...ns.map((n) => fc.record({ n: fc.constant(n), kind: kindArb })))),
  },
);

const afterArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant<number | null>(null) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 0xffff }) },
);

function check(
  entries: readonly { n: number; kind: Kind }[],
  withoutSummary: boolean | undefined,
  afterN: number | null,
): boolean {
  const store = memoryStore(entries);
  const args: Record<string, string | boolean> = {};
  if (withoutSummary !== undefined) args["withoutSummary"] = withoutSummary;
  if (afterN !== null) args["after"] = idOf(afterN);
  const res = callTool(store, "list_disks", args);
  if (res.isError) return false;
  const text = res.content[0]?.text ?? "";
  const body = JSON.parse(text) as ListBody;
  const disks = body.disks;
  if (disks === undefined) return false;

  // Size cap and untrusted envelope (Requirements 9.11, 17.3).
  if (text.length > MAX_RESPONSE_CHARS) return false;
  if (body.untrusted !== true || body.notice !== NOTICE) return false;

  // Expected result set, computed independently of the implementation.
  const sorted = entries.map((e) => ({ id: idOf(e.n), kind: e.kind })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const after = afterN === null ? undefined : idOf(afterN);
  const matching = sorted.filter(
    (e) => (after === undefined || e.id > after) && (withoutSummary !== true || e.kind === "none"),
  );

  // Cap, strictly ascending order, and the filters.
  if (disks.length > MAX_LIST_DISKS) return false;
  if (disks.length > matching.length) return false;
  for (let i = 0; i < disks.length; i++) {
    const d = disks[i];
    const want = matching[i];
    if (d === undefined || want === undefined || d.diskId !== want.id) return false; // prefix of the ordered match list
    if (i > 0 && (disks[i - 1]?.diskId ?? "") >= d.diskId) return false;
    if (withoutSummary === true && d.summary !== null) return false;
  }

  // Truncation flag, total and cursor.
  if (body.truncated !== (disks.length < matching.length)) return false;
  if (body.total !== entries.length) return false;
  const last = disks[disks.length - 1];
  if (body.nextAfter !== (last === undefined ? null : last.diskId)) return false;

  // Without the size trim, exactly min(200, matching) disks come back.
  if (disks.length < Math.min(MAX_LIST_DISKS, matching.length) && text.length <= MAX_RESPONSE_CHARS / 2) {
    return false;
  }
  return true;
}

describe("Feature: crew-app, Property 27: list_disks cap, order, size and filter", () => {
  it("returns at most 200 disks in ascending Disk_Id order, after the cursor, honouring withoutSummary, within 256 KB", () => {
    fc.assert(
      fc.property(entriesArb, fc.constantFrom(undefined, true, false), afterArb, (entries, filter, afterN) =>
        check(entries, filter, afterN),
      ),
      { numRuns: 120 },
    );
  }, 120_000);

  it("pages through the whole catalogue with nextAfter without gaps or repeats", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 450 })
          .map((ns) => ns.map((n) => ({ n, kind: "none" as Kind }))),
        (entries) => {
          const store = memoryStore(entries);
          const seen: string[] = [];
          let after: string | undefined;
          for (let page = 0; page < 5; page++) {
            const res = callTool(store, "list_disks", after === undefined ? {} : { after });
            const body = JSON.parse(res.content[0]?.text ?? "{}") as ListBody;
            if (res.isError || body.disks === undefined) return false;
            seen.push(...body.disks.map((d) => d.diskId));
            if (body.truncated !== true) break;
            if (typeof body.nextAfter !== "string") return false;
            after = body.nextAfter;
          }
          const expected = entries.map((e) => idOf(e.n)).sort();
          return JSON.stringify(seen) === JSON.stringify(expected);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
