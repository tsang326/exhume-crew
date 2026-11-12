import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { sanitizeAgentText } from "../shared/sanitize";
import { CAPS, codePointLength, type DiskCard } from "../shared/schema";
import { createStore, emptyCatalogue, type Store } from "../shared/store";
import { callTool } from "./tools";

const DISK = "ab".repeat(32);

function makeCard(): DiskCard {
  return {
    diskId: DISK,
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

/** Runs `body` against a fresh Store holding one known disk; the temp dir is always removed. */
function withStore(body: (store: Store) => boolean): boolean {
  const dir = mkdtempSync(join(tmpdir(), "bounds-prop-"));
  try {
    const store = createStore(dir);
    const seeded = store.update((d) => {
      d.cards[DISK] = makeCard();
    });
    if (!seeded.ok) return false;
    return body(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Text with controls, separators, BOM, astral characters and lone surrogates mixed in.
const noisyUnit = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom("a", "b", "é", " ") },
  { weight: 2, arbitrary: fc.constantFrom("\u0000", "\u0007", "\n", "\u007f", "\u0085", "\u2028", "\u202e", "\ufeff") },
  { weight: 2, arbitrary: fc.constantFrom("😀", "𝒳", "\ud800", "\udc00") },
);
const noisy = (maxLength: number) => fc.string({ unit: noisyUnit, maxLength });

/** Lengths clustered at the cap, with a few control characters that sanitising removes. */
const nearCap = (cap: number) =>
  fc
    .tuple(
      fc.integer({ min: cap - 3, max: cap + 3 }),
      fc.constantFrom("a", "😀"),
      fc.array(fc.constantFrom("\u0000", "\n", "\ufeff"), { maxLength: 5 }),
    )
    .map(([n, ch, junk]) => ch.repeat(n) + junk.join(""));

const inputFor = (cap: number) =>
  fc.oneof(
    { weight: 3, arbitrary: nearCap(cap) },
    { weight: 3, arbitrary: noisy(cap + 40) },
    { weight: 1, arbitrary: fc.constantFrom("", "\u0000\n\ufeff") },
  );

const summaryInput = inputFor(CAPS.summary);
const noteInput = inputFor(CAPS.note);
const agent = fc.constantFrom("exhume-archivist" as const, "exhume-undertaker" as const);

function parse(text: string | undefined): Record<string, unknown> {
  return JSON.parse(text ?? "{}") as Record<string, unknown>;
}

function cardOf(store: Store): { summary: { text: string } | null; notes: { text: string }[] } | undefined {
  const res = callTool(store, "get_disk_card", { disk: DISK });
  if (res.isError) return undefined;
  const body = parse(res.content[0]?.text) as {
    card?: { summary: { text: string } | null; notes: { text: string }[] };
  };
  return body.card;
}

function errorCode(res: { isError: boolean; content: { text: string }[] }): unknown {
  return res.isError ? parse(res.content[0]?.text)["error"] : undefined;
}

const accepted = (input: string, cap: number): boolean => {
  const n = codePointLength(sanitizeAgentText(input));
  return n >= 1 && n <= cap;
};

describe("Feature: crew-app, Property 26: Summary and note bounds and round trip", () => {
  it("save_disk_summary accepts iff the sanitised text has 1..1200 code points; the card returns it; later replaces earlier", () => {
    fc.assert(
      fc.property(summaryInput, summaryInput, agent, (first, second, who) =>
        withStore((store) => {
          for (const input of [first, second]) {
            const before = store.read();
            const res = callTool(store, "save_disk_summary", { disk: DISK, summary: input, agent: who });
            const after = store.read();
            const shouldAccept = accepted(input, CAPS.summary);
            if (res.isError === shouldAccept) return false;
            if (!shouldAccept) {
              if (errorCode(res) !== "INVALID_LENGTH") return false;
              if (!before.ok || !after.ok) return false;
              if (JSON.stringify(before.value) !== JSON.stringify(after.value)) return false;
            }
          }
          // Expected final summary: the last accepted input, else none.
          const last = [second, first].find((s) => accepted(s, CAPS.summary));
          const view = cardOf(store);
          if (view === undefined) return false;
          if (last === undefined) return view.summary === null;
          return view.summary !== null && view.summary.text === sanitizeAgentText(last);
        }),
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  it("add_disk_note accepts iff the sanitised text has 1..500 code points; accepted notes round trip; rejected leave the Store unchanged", () => {
    fc.assert(
      fc.property(fc.array(noteInput, { minLength: 1, maxLength: 4 }), agent, (inputs, who) =>
        withStore((store) => {
          const expected: string[] = [];
          for (const input of inputs) {
            const before = store.read();
            const res = callTool(store, "add_disk_note", { disk: DISK, note: input, agent: who });
            const after = store.read();
            const shouldAccept = accepted(input, CAPS.note);
            if (res.isError === shouldAccept) return false;
            if (shouldAccept) {
              expected.push(sanitizeAgentText(input));
            } else {
              if (errorCode(res) !== "INVALID_LENGTH") return false;
              if (!before.ok || !after.ok) return false;
              if (JSON.stringify(before.value) !== JSON.stringify(after.value)) return false;
            }
          }
          const view = cardOf(store);
          if (view === undefined) return false;
          return JSON.stringify(view.notes.map((n) => n.text)) === JSON.stringify(expected);
        }),
      ),
      { numRuns: 150 },
    );
  }, 120_000);
});
