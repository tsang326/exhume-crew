import { describe, it } from "vitest";
import fc from "fast-check";
import { deriveCard } from "./card";
import type { DeriveCardInput, ReportEntry } from "./card";
import type { CardWarning, FormatFamily, GraveState } from "./schema";

const KNOWN: Record<number, string> = {
  368640: "360K",
  737280: "720K",
  1228800: "1.2M",
  1474560: "1.44M",
  2949120: "2.88M",
};

const FAMILIES: FormatFamily[] = ["markdown", "csv", "png", "text"];

const isoDate = fc
  .integer({ min: Date.UTC(1980, 0, 1), max: Date.UTC(2107, 11, 31) })
  .map((t) => new Date(t).toISOString());

const entry: fc.Arbitrary<ReportEntry> = fc.record({
  kind: fc.constantFrom("file" as const, "directory" as const),
  date: fc.option(isoDate, { nil: null }),
});

const warning: fc.Arbitrary<CardWarning> = fc.record(
  { code: fc.string({ maxLength: 8 }), message: fc.string({ maxLength: 20 }), path: fc.string({ maxLength: 10 }) },
  { requiredKeys: ["code", "message"] },
);

const count = fc.nat({ max: 5000 });

const input: fc.Arbitrary<DeriveCardInput> = fc.record({
  diskId: fc.stringMatching(/^[0-9a-f]{64}$/),
  relPath: fc.string({ minLength: 1, maxLength: 20 }),
  sizeBytes: fc.oneof(
    fc.constantFrom(...Object.keys(KNOWN).map(Number)),
    fc.nat({ max: 10_000_000 }),
  ),
  firstSeen: isoDate,
  report: fc.record({
    volume: fc.record({
      label: fc.string({ maxLength: 20 }),
      geometrySource: fc.constantFrom("bpb" as const, "fallback" as const, "none" as const),
    }),
    totalEntries: count,
    counts: fc.record({ alive: count, recovered: count, partial: count, lost: count }) as fc.Arbitrary<
      Record<GraveState, number>
    >,
    entries: fc.array(entry, { maxLength: 40 }),
    truncated: fc.boolean(),
    warnings: fc.array(warning, { maxLength: 130 }),
  }),
  formats: fc.array(fc.constantFrom(...FAMILIES), { maxLength: 12 }),
  scannerWarnings: fc.array(warning, { maxLength: 130 }),
});

describe("Feature: crew-app, Property 12: Card derivation matches the report", () => {
  it("copies counts, derives file count, date range, formats, geometry label and caps warnings", () => {
    fc.assert(
      fc.property(input, (inp) => {
        const card = deriveCard(inp);
        const { report } = inp;

        const files = report.entries.filter((e) => e.kind === "file");
        const times = files.flatMap((e) => (e.date === null ? [] : [Date.parse(e.date)]));
        const wantFirst = times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
        const wantLast = times.length === 0 ? null : new Date(Math.max(...times)).toISOString();

        const wantFormats = FAMILIES.filter((f) => (inp.formats ?? []).includes(f)).sort();
        const wantLabel = KNOWN[inp.sizeBytes] ?? null;

        const all = [...report.warnings, ...(inp.scannerWarnings ?? [])];
        const wantWarnLen = Math.min(100, all.length);
        const warningsOk =
          card.warnings.length === wantWarnLen &&
          card.warnings.every((w, i) => w.code === all[i]?.code && w.message === all[i]?.message);

        return (
          card.counts.alive === report.counts.alive &&
          card.counts.recovered === report.counts.recovered &&
          card.counts.partial === report.counts.partial &&
          card.counts.lost === report.counts.lost &&
          card.fileCount === files.length &&
          card.dateFirst === wantFirst &&
          card.dateLast === wantLast &&
          JSON.stringify(card.formats) === JSON.stringify(wantFormats) &&
          card.geometry.label === wantLabel &&
          warningsOk
        );
      }),
      { numRuns: 200 },
    );
  });

  it("geometry label depends only on the image size", () => {
    fc.assert(
      fc.property(input, input, (a, b) => {
        const x = deriveCard({ ...a, sizeBytes: b.sizeBytes });
        const y = deriveCard({ ...b });
        return x.geometry.label === y.geometry.label;
      }),
      { numRuns: 100 },
    );
  });
});
