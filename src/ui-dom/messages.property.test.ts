import fc from "fast-check";
import { describe, it } from "vitest";
import {
  SUMMARISE_PREFIX,
  UNDERTAKER_PREFIX,
  buildSummariseMessage,
  buildUndertakerMessage,
} from "../../ui/src/lib/messages";

// Feature: crew-app, Property 30: Chat messages contain only fixed text and Disk_Ids
// **Validates: Requirements 13.5, 13.6, 14.8, 15.2, 16.4**

const diskId = fc.stringMatching(/^[0-9a-f]{64}$/);

interface TestCard {
  id: string;
  name: string;
  label: string;
  summary: string | null;
  notes: string[];
}

// Card text deliberately includes characters that never occur in a message.
const hostile = fc.string({ unit: "binary", maxLength: 80 }).map((s) => "<>!" + s);

const card = fc.record({
  id: diskId,
  name: hostile,
  label: hostile,
  summary: fc.option(hostile, { nil: null }),
  notes: fc.array(hostile, { maxLength: 3 }),
});

const cards = fc.uniqueArray(card, { selector: (c) => c.id, maxLength: 20 });

function newIds(list: readonly TestCard[]): string[] {
  return list.filter((c) => c.summary === null).map((c) => c.id);
}

describe("Property 30: Chat messages contain only fixed text and Disk_Ids", () => {
  it("summarise message is the fixed prefix plus the Disk_Ids of cards without a summary", () => {
    fc.assert(
      fc.property(cards, (list) => {
        const ids = newIds(list);
        const msg = buildSummariseMessage(ids);
        if (ids.length === 0) return msg === null;
        return msg === SUMMARISE_PREFIX + ids.join(" ");
      }),
      { numRuns: 100 },
    );
  });

  it("undertaker message is the fixed prefix plus the one Disk_Id", () => {
    fc.assert(
      fc.property(cards, diskId, (list, id) => {
        void list;
        return buildUndertakerMessage(id) === UNDERTAKER_PREFIX + id;
      }),
      { numRuns: 100 },
    );
  });

  it("no card text appears in either message", () => {
    fc.assert(
      fc.property(cards, (list) => {
        const ids = newIds(list);
        const messages: string[] = list.map((c) => buildUndertakerMessage(c.id));
        const summarise = buildSummariseMessage(ids);
        if (summarise !== null) messages.push(summarise);
        // Hostile card text always starts with "<>!", which no fixed prefix or id contains.
        return messages.every((m) => !m.includes("<>!"));
      }),
      { numRuns: 100 },
    );
  });
});
