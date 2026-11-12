import { describe, it } from "vitest";
import fc from "fast-check";
import { cardStatus, deriveCard, toCardView } from "./card";
import type { Annotation, DiskCard, Status, Summary } from "./schema";

type Op = "scan" | "summarise";

const ops = fc.array(fc.constantFrom<Op>("scan", "summarise"), { maxLength: 12 });

const summary: Summary = { text: "s", savedAt: "2024-01-01T00:00:00Z", agent: "exhume-archivist" };

function scanCard(hasSummary: boolean): DiskCard {
  return deriveCard({
    diskId: "d1",
    relPath: "a.img",
    sizeBytes: 1_474_560,
    firstSeen: "2024-01-01T00:00:00Z",
    report: {
      volume: { label: "L", geometrySource: "bpb" },
      totalEntries: 0,
      counts: { alive: 0, recovered: 0, partial: 0, lost: 0 },
      entries: [],
      truncated: false,
      warnings: [],
    },
    hasSummary,
  });
}

/**
 * Replays the ops against the real derivation and returns the status after
 * each step, alongside the status the rules in Requirement 5.9 require.
 */
function replay(seq: readonly Op[]): { got: Status; want: Status }[] {
  const out: { got: Status; want: Status }[] = [];
  let card: DiskCard | null = null;
  let annotation: Annotation | undefined;
  for (const op of seq) {
    if (op === "scan") {
      // A rescan derives without knowing about the Summary; the view merges it.
      card = scanCard(false);
    } else {
      annotation = { summary, notes: [] };
    }
    const hasSummary = annotation?.summary != null;
    const want: Status = hasSummary ? "summarised" : card !== null ? "catalogued" : "new";
    let got: Status;
    if (card !== null) {
      got = toCardView(card, annotation).status;
    } else {
      got = cardStatus({ stored: false, hasSummary });
    }
    out.push({ got, want });
  }
  return out;
}

describe("Feature: crew-app, Property 13: Status derivation", () => {
  // **Validates: Requirements 5.9**
  it("follows new, catalogued, summarised and a rescan never lowers summarised", () => {
    fc.assert(
      fc.property(ops, (seq) => replay(seq).every((s) => s.got === s.want)),
      { numRuns: 200 },
    );
  });

  it("is new before storing, catalogued after, and summarised iff a Summary exists", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (stored, hasSummary) => {
        const got = cardStatus({ stored, hasSummary });
        const want: Status = hasSummary ? "summarised" : stored ? "catalogued" : "new";
        const derived = scanCard(hasSummary).status === (hasSummary ? "summarised" : "catalogued");
        return got === want && derived;
      }),
      { numRuns: 100 },
    );
  });
});
