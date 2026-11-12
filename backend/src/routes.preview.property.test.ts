/**
 * Feature: crew-app, Property 19: Preview truncation
 *
 * For any text returned by read_grave, including multi-byte characters, the preview text is at
 * most 65,536 bytes of UTF-8, is a prefix of the original that ends on a character boundary,
 * equals the original when the original fits, and `truncated` is true if and only if something
 * was cut (by the server or the Backend).
 *
 * **Validates: Requirements 7.7**
 */
import { describe, it } from "vitest";
import fc from "fast-check";
import { emptyCatalogue } from "../../src/shared/store";
import type { Store } from "../../src/shared/store";
import type { CatalogueData, DiskCard, FileEntry } from "../../src/shared/schema";
import type { ExhumeClient, ReadGraveResult } from "./exhume-client";
import { MAX_PREVIEW_BYTES, createRoutes } from "./routes";
import type { PreviewResponse, Route, RouteDeps } from "./routes";

const NUM_RUNS = 100;
const DISK_ID = "a".repeat(64);
const ENTRY_ID = 7;

const card: DiskCard = {
  diskId: DISK_ID,
  relPath: "disk.img",
  label: "DISK",
  sizeBytes: 512,
  geometry: { source: "bpb", label: null },
  fileCount: 1,
  totalEntries: 1,
  entriesTruncated: false,
  dateFirst: null,
  dateLast: null,
  formats: ["text"],
  counts: { alive: 1, recovered: 0, partial: 0, lost: 0 },
  warnings: [],
  status: "new",
  firstSeen: "2024-01-01T00:00:00.000Z",
};

const entry: FileEntry = { id: ENTRY_ID, path: "A.TXT", kind: "file", state: "alive", size: 1, date: null };

function fakeStore(): Store {
  const data: CatalogueData = emptyCatalogue();
  data.cards[DISK_ID] = card;
  return {
    read: () => ({ ok: true, value: data }),
    update: () => ({ ok: true, value: undefined }),
    readFiles: () => ({
      ok: true,
      value: { schemaVersion: 1, diskId: DISK_ID, totalEntries: 1, truncated: false, entries: [entry] },
    }),
    writeFiles: () => ({ ok: true, value: undefined }),
  };
}

function previewRoute(text: string, serverTruncated: boolean): Route {
  const exhume: RouteDeps["exhume"] = {
    readGrave: () =>
      Promise.resolve({
        grave: { id: ENTRY_ID, path: "A.TXT", state: "alive" },
        format: "text",
        mime: "text/plain",
        extension: "txt",
        text,
        totalChars: text.length,
        truncated: serverTruncated,
        warnings: [],
        warningsOmitted: 0,
      } as unknown as ReadGraveResult),
    exhume: () => Promise.reject(new Error("unused")),
  } satisfies Pick<ExhumeClient, "readGrave" | "exhume">;
  const routes = createRoutes({
    store: fakeStore(),
    scanner: { getStatus: () => { throw new Error("unused"); }, triggerScan: () => ({ started: false, running: false }) },
    library: {
      getStatus: () => ({ path: "", error: null }) as never,
      getRealPath: () => null,
      setLibrary: () => Promise.reject(new Error("unused")),
    },
    exhume,
    copyDemo: () => Promise.reject(new Error("unused")),
    hashImage: () => Promise.resolve(null),
    clock: { now: () => 0 },
  });
  const route = routes.find((r) => r.pattern.includes("preview"));
  if (route === undefined) throw new Error("preview route missing");
  return route;
}

async function runPreview(text: string, serverTruncated: boolean): Promise<PreviewResponse> {
  const result = await previewRoute(text, serverTruncated).handler({
    params: { id: DISK_ID },
    query: { entry: String(ENTRY_ID) },
    body: new Uint8Array(),
  });
  if (result.kind !== "json") throw new Error("expected json");
  return result.body as PreviewResponse;
}

// Characters of 1, 2, 3 and 4 UTF-8 bytes (no lone surrogates).
const unit = fc.constantFrom("a", "é", "€", "😀", "\u0000", "\n", "漢");

/** Free-form text, mostly well under the limit. */
const smallText = fc.array(unit, { maxLength: 200 }).map((a) => a.join(""));

/** Text built around the 65,536-byte boundary so cuts land inside multi-byte characters. */
const boundaryText = fc
  .record({
    pad: fc.integer({ min: 65_526, max: 65_540 }),
    tail: fc.array(unit, { minLength: 1, maxLength: 12 }),
  })
  .map(({ pad, tail }) => "a".repeat(pad) + tail.join(""));

/** Large text of repeated multi-byte blocks, often well past the limit. */
const bigText = fc
  .array(fc.tuple(unit, fc.integer({ min: 1, max: 4000 })), { minLength: 1, maxLength: 30 })
  .map((parts) => parts.map(([c, n]) => c.repeat(n)).join(""));

const anyText = fc.oneof(smallText, boundaryText, bigText);

function holds(original: string, serverTruncated: boolean, res: PreviewResponse): boolean {
  if (res.kind !== "text") return false;
  const outBytes = Buffer.byteLength(res.text, "utf8");
  const origBytes = Buffer.byteLength(original, "utf8");
  const fits = origBytes <= MAX_PREVIEW_BYTES;

  if (outBytes > MAX_PREVIEW_BYTES) return false;
  if (!original.startsWith(res.text)) return false; // prefix, never splits a code point
  if (res.text.includes("\uFFFD") && !original.includes("\uFFFD")) return false;
  if (fits && res.text !== original) return false;
  if (!fits) {
    // Cut as late as possible: the next code point would not have fit.
    const next = original.codePointAt(res.text.length) ?? 0;
    const nextBytes = Buffer.byteLength(String.fromCodePoint(next), "utf8");
    if (outBytes + nextBytes <= MAX_PREVIEW_BYTES) return false;
  }
  const cutByBackend = !fits;
  return res.truncated === (serverTruncated || cutByBackend);
}

describe("Feature: crew-app, Property 19: Preview truncation", () => {
  it("keeps a bounded, boundary-safe prefix and reports truncation exactly when something was cut", async () => {
    await fc.assert(
      fc.asyncProperty(anyText, fc.boolean(), async (text, serverTruncated) => {
        const res = await runPreview(text, serverTruncated);
        return holds(text, serverTruncated, res);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
