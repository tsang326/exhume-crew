/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON tool results are inspected loosely */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAPS, type DiskCard } from "../shared/schema";
import { createStore, emptyCatalogue, type Store } from "../shared/store";
import { callTool, ERROR_MESSAGES, MAX_LIST_DISKS, MAX_RESPONSE_CHARS, NOTICE } from "./tools";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "catalogue-tools-"));
  store = createStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const id = (n: number): string => n.toString(16).padStart(64, "0");

function makeCard(diskId: string, extra: Partial<DiskCard> = {}): DiskCard {
  return {
    diskId,
    relPath: "a/disk.img",
    label: "LABEL",
    sizeBytes: 1440,
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
    ...extra,
  };
}

function seed(cards: DiskCard[]): void {
  const r = store.update((d) => {
    for (const c of cards) d.cards[c.diskId] = c;
  });
  expect(r.ok).toBe(true);
}

function body(result: { content: { text: string }[] }): Record<string, any> {
  return JSON.parse(result.content[0]!.text) as Record<string, any>;
}

describe("catalogue tools", () => {
  it("list_disks returns cards in ascending Disk_Id order with the notice", () => {
    seed([makeCard(id(3)), makeCard(id(1)), makeCard(id(2))]);
    const res = callTool(store, "list_disks", {});
    expect(res.isError).toBe(false);
    const b = body(res);
    expect(b.untrusted).toBe(true);
    expect(b.notice).toBe(NOTICE);
    expect(b.total).toBe(3);
    expect(b.truncated).toBe(false);
    expect(b.disks.map((d: any) => d.diskId)).toEqual([id(1), id(2), id(3)]);
    expect(b.nextAfter).toBe(id(3));
  });

  it("list_disks supports withoutSummary and the after cursor", () => {
    seed([makeCard(id(1)), makeCard(id(2)), makeCard(id(3))]);
    callTool(store, "save_disk_summary", { disk: id(2), summary: "done", agent: "exhume-archivist" });
    const without = body(callTool(store, "list_disks", { withoutSummary: true }));
    expect(without.disks.map((d: any) => d.diskId)).toEqual([id(1), id(3)]);
    const after = body(callTool(store, "list_disks", { after: id(1) }));
    expect(after.disks.map((d: any) => d.diskId)).toEqual([id(2), id(3)]);
  });

  it("list_disks on an empty catalogue succeeds", () => {
    const b = body(callTool(store, "list_disks", {}));
    expect(b.disks).toEqual([]);
    expect(b.nextAfter).toBeNull();
  });

  it("list_disks caps the result at 200 disks and flags truncation", () => {
    seed(Array.from({ length: MAX_LIST_DISKS + 5 }, (_, i) => makeCard(id(i))));
    const b = body(callTool(store, "list_disks", {}));
    expect(b.disks).toHaveLength(MAX_LIST_DISKS);
    expect(b.truncated).toBe(true);
    expect(b.total).toBe(MAX_LIST_DISKS + 5);
    const next = body(callTool(store, "list_disks", { after: b.nextAfter }));
    expect(next.disks).toHaveLength(5);
    expect(next.truncated).toBe(false);
  });

  it("list_disks trims from the end to stay within 256 KB", () => {
    const big = "x".repeat(3000);
    const warnings = Array.from({ length: 20 }, (_, i) => ({
      code: "W",
      message: `${i}${big}`,
    }));
    seed(Array.from({ length: 10 }, (_, i) => makeCard(id(i), { warnings })));
    const res = callTool(store, "list_disks", {});
    expect(res.content[0]!.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    const b = body(res);
    expect(b.disks.length).toBeGreaterThan(0);
    expect(b.disks.length).toBeLessThan(10);
    expect(b.truncated).toBe(true);
    expect(b.nextAfter).toBe(b.disks[b.disks.length - 1].diskId);
  });

  it("get_disk_card returns the card with summary and notes", () => {
    seed([makeCard(id(1))]);
    callTool(store, "save_disk_summary", { disk: id(1), summary: "S", agent: "exhume-archivist" });
    callTool(store, "add_disk_note", { disk: id(1), note: "N", agent: "exhume-undertaker" });
    const res = callTool(store, "get_disk_card", { disk: id(1) });
    expect(res.isError).toBe(false);
    const b = body(res);
    expect(b.untrusted).toBe(true);
    expect(b.notice).toBe(NOTICE);
    expect(b.card.diskId).toBe(id(1));
    expect(b.card.status).toBe("summarised");
    expect(b.card.summary.text).toBe("S");
    expect(b.card.notes.map((n: any) => n.text)).toEqual(["N"]);
  });

  it("save_disk_summary stores the summary, replaces earlier ones and records provenance", () => {
    seed([makeCard(id(1))]);
    const now = () => new Date("2025-02-03T04:05:06.000Z");
    const res = callTool(store, "save_disk_summary", { disk: id(1), summary: "first", agent: "exhume-archivist" }, { now });
    expect(res.isError).toBe(false);
    expect(body(res)).toEqual({ ok: true, savedAt: "2025-02-03T04:05:06.000Z", chars: 5 });
    callTool(store, "save_disk_summary", { disk: id(1), summary: "second", agent: "exhume-undertaker" });
    const data = store.read();
    if (!data.ok) throw new Error("read failed");
    expect(data.value.annotations[id(1)]!.summary).toMatchObject({ text: "second", agent: "exhume-undertaker" });
    expect(data.value.cards[id(1)]!.status).toBe("summarised");
  });

  it("add_disk_note appends notes with the injected id and time", () => {
    seed([makeCard(id(1))]);
    const res = callTool(
      store,
      "add_disk_note",
      { disk: id(1), note: "hello", agent: "exhume-archivist" },
      { now: () => new Date("2025-01-01T00:00:00.000Z"), newNoteId: () => "note-1" },
    );
    expect(res.isError).toBe(false);
    expect(body(res)).toEqual({ ok: true, savedAt: "2025-01-01T00:00:00.000Z", noteId: "note-1" });
    const data = store.read();
    if (!data.ok) throw new Error("read failed");
    expect(data.value.annotations[id(1)]!.notes).toEqual([
      { id: "note-1", text: "hello", savedAt: "2025-01-01T00:00:00.000Z", agent: "exhume-archivist" },
    ]);
  });

  it("enforces summary and note length caps", () => {
    seed([makeCard(id(1))]);
    const agent = "exhume-archivist";
    const s = (summary: string) => callTool(store, "save_disk_summary", { disk: id(1), summary, agent });
    const n = (note: string) => callTool(store, "add_disk_note", { disk: id(1), note, agent });
    expect(s("a".repeat(CAPS.summary)).isError).toBe(false);
    expect(s("a".repeat(CAPS.summary + 1)).isError).toBe(true);
    expect(body(s("a".repeat(CAPS.summary + 1)))).toEqual({ error: "INVALID_LENGTH", message: ERROR_MESSAGES.INVALID_LENGTH });
    expect(s("").isError).toBe(true);
    // Text that is empty after stripping is rejected.
    expect(body(s("\u0000\u0007")).error).toBe("INVALID_LENGTH");
    expect(n("b".repeat(CAPS.note)).isError).toBe(false);
    expect(body(n("b".repeat(CAPS.note + 1))).error).toBe("INVALID_LENGTH");
    expect(body(n("")).error).toBe("INVALID_LENGTH");
  });

  it("enforces the 100 note cap", () => {
    seed([makeCard(id(1))]);
    for (let i = 0; i < CAPS.notes; i++) {
      const r = callTool(store, "add_disk_note", { disk: id(1), note: `n${i}`, agent: "exhume-undertaker" });
      expect(r.isError).toBe(false);
    }
    const res = callTool(store, "add_disk_note", { disk: id(1), note: "one too many", agent: "exhume-undertaker" });
    expect(res.isError).toBe(true);
    expect(body(res).error).toBe("NOTES_FULL");
    const data = store.read();
    if (!data.ok) throw new Error("read failed");
    expect(data.value.annotations[id(1)]!.notes).toHaveLength(CAPS.notes);
  });

  it("strips control characters from saved text and from returned content", () => {
    seed([makeCard(id(1))]);
    callTool(store, "save_disk_summary", { disk: id(1), summary: "a\u0000b\u202ecd\ufeff", agent: "exhume-archivist" });
    callTool(store, "add_disk_note", { disk: id(1), note: "x\u0007y\u2028z", agent: "exhume-archivist" });
    const card = body(callTool(store, "get_disk_card", { disk: id(1) })).card;
    expect(card.summary.text).toBe("abcd");
    expect(card.notes[0].text).toBe("xyz");
  });

  it("strips untrusted text already in the store when it is returned", () => {
    seed([
      makeCard(id(1), {
        label: "LA\u0000B\u202eEL",
        relPath: "dir/\u0007file\n.img",
        warnings: [{ code: "W", message: "m\u0000sg", path: "p\u202eath" }],
      }),
    ]);
    // Write annotation text that bypasses the tool's own input stripping.
    const r = store.update((d) => {
      d.annotations[id(1)] = {
        summary: { text: "su\u0000mm\u202eary", savedAt: "2025-01-01T00:00:00.000Z", agent: "exhume-archivist" },
        notes: [{ id: "n1", text: "no\u0007te", savedAt: "2025-01-01T00:00:00.000Z", agent: "exhume-archivist" }],
      };
    });
    expect(r.ok).toBe(true);
    const card = body(callTool(store, "get_disk_card", { disk: id(1) })).card;
    expect(card.label).toBe("LABEL");
    expect(card.relPath).toBe("dir/file .img");
    expect(card.warnings[0]).toEqual({ code: "W", message: "msg", path: "path" });
    expect(card.summary.text).toBe("summary");
    expect(card.notes[0].text).toBe("note");
    const listed = body(callTool(store, "list_disks", {})).disks[0];
    expect(listed.label).toBe("LABEL");
    expect(listed.summary.text).toBe("summary");
  });

  it("returns DISK_NOT_FOUND for an unknown Disk_Id without writing", () => {
    seed([makeCard(id(1))]);
    const unknown = id(99);
    const expected = { error: "DISK_NOT_FOUND", message: ERROR_MESSAGES.DISK_NOT_FOUND };
    const results = [
      callTool(store, "get_disk_card", { disk: unknown }),
      callTool(store, "save_disk_summary", { disk: unknown, summary: "s", agent: "exhume-archivist" }),
      callTool(store, "add_disk_note", { disk: unknown, note: "n", agent: "exhume-archivist" }),
    ];
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(body(r)).toEqual(expected);
    }
    const data = store.read();
    if (!data.ok) throw new Error("read failed");
    expect(data.value.annotations[unknown]).toBeUndefined();
    expect(Object.keys(data.value.cards)).toEqual([id(1)]);
  });

  it("rejects invalid requests with fixed messages that never echo input", () => {
    seed([makeCard(id(1))]);
    const secret = "SECRET-INPUT-123";
    const cases: [string, Record<string, any>][] = [
      ["get_disk_card", { disk: secret }],
      ["get_disk_card", {}],
      ["list_disks", { extra: secret }],
      ["list_disks", { after: secret }],
      ["save_disk_summary", { disk: id(1), summary: "s", agent: secret }],
      ["add_disk_note", { disk: id(1), note: "n" }],
      [secret, {}],
    ];
    for (const [name, args] of cases) {
      const res = callTool(store, name, args);
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).not.toContain(secret);
    }
  });

  it("works on an empty store created without cards", () => {
    expect(store.read()).toEqual({ ok: true, value: emptyCatalogue() });
    expect(body(callTool(store, "get_disk_card", { disk: id(1) })).error).toBe("DISK_NOT_FOUND");
  });
});
