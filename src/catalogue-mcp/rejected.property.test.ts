import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import type { DiskCard } from "../shared/schema";
import { createStore } from "../shared/store";
import type { JsonObject } from "./jsonrpc";
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

/** Every file under the data dir: relative name and bytes. Directories are listed by name only. */
function snapshot(dir: string): string {
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
  const parts = names.map((n) => {
    try {
      return `${n}\u0000${readFileSync(join(dir, n)).toString("base64")}`;
    } catch {
      return `${n}\u0000<dir>`;
    }
  });
  return parts.join("\n");
}

// Every supplied string carries this marker, so echoing any of it is detectable.
const marker = fc.string({ minLength: 1, maxLength: 20 }).map((s) => `ZQX${s}`);
const hexId = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 })
  .map((a) => a.join(""))
  .filter((id) => id !== DISK);
const validText = fc.constantFrom("A fine summary", "A fine note");
const agentOk = fc.constantFrom("exhume-archivist", "exhume-undertaker");
const wrongType = fc.constantFrom<unknown>(1, 0, true, false, null, [], ["x"], {}, { a: 1 });

interface Case {
  name: string;
  args: JsonObject;
  code: "DISK_NOT_FOUND" | "INVALID_REQUEST";
  supplied: string[];
}

const toolWithText = fc.constantFrom(
  { name: "save_disk_summary", key: "summary" },
  { name: "add_disk_note", key: "note" },
);

const unknownDisk: fc.Arbitrary<Case> = fc
  .tuple(
    fc.constantFrom(
      { name: "get_disk_card", key: "" },
      { name: "save_disk_summary", key: "summary" },
      { name: "add_disk_note", key: "note" },
    ),
    fc.oneof(hexId, marker),
    validText,
    agentOk,
  )
  .map(([tool, disk, text, agent]) => ({
    name: tool.name,
    args: (tool.key === "" ? { disk } : { disk, [tool.key]: text, agent }) as JsonObject,
    code: "DISK_NOT_FOUND" as const,
    supplied: [disk],
  }));

const badShape: fc.Arbitrary<Case> = fc
  .tuple(toolWithText, wrongType, fc.constantFrom("disk", "text", "agent"), fc.constantFrom("drop", "retype"), agentOk)
  .map(([tool, bad, field, how, agent]) => {
    const args: Record<string, unknown> = { disk: DISK, [tool.key]: "A fine text", agent };
    const key = field === "text" ? tool.key : field;
    if (how === "drop") delete args[key];
    else args[key] = bad;
    return { name: tool.name, args: args as JsonObject, code: "INVALID_REQUEST" as const, supplied: [] };
  });

const extraKey: fc.Arbitrary<Case> = fc
  .tuple(
    fc.constantFrom("list_disks", "get_disk_card", "save_disk_summary", "add_disk_note"),
    marker,
    marker,
  )
  .map(([name, key, value]) => {
    const base: Record<string, JsonObject[string]> =
      name === "list_disks"
        ? {}
        : name === "get_disk_card"
          ? { disk: DISK }
          : { disk: DISK, [name === "save_disk_summary" ? "summary" : "note"]: "A fine text", agent: "exhume-archivist" };
    return { name, args: { ...base, [key]: value } as JsonObject, code: "INVALID_REQUEST" as const, supplied: [key, value] };
  });

const badAgent: fc.Arbitrary<Case> = fc
  .tuple(toolWithText, fc.oneof(marker, wrongType))
  .map(([tool, agent]) => ({
    name: tool.name,
    args: { disk: DISK, [tool.key]: "A fine text", agent } as JsonObject,
    code: "INVALID_REQUEST" as const,
    supplied: typeof agent === "string" ? [agent] : [],
  }));

const badListArgs: fc.Arbitrary<Case> = fc
  .oneof(
    fc.record({ withoutSummary: fc.oneof(marker, fc.constantFrom<unknown>(1, null, [], {})) }),
    fc.record({ after: fc.oneof(marker, fc.constantFrom<unknown>(1, null, true, [], {})) }),
  )
  .map((args) => ({
    name: "list_disks",
    args: args as JsonObject,
    code: "INVALID_REQUEST" as const,
    supplied: Object.values(args).filter((v): v is string => typeof v === "string"),
  }));

const unknownTool: fc.Arbitrary<Case> = fc.tuple(marker, marker).map(([name, value]) => ({
  name,
  args: { disk: DISK, value } as JsonObject,
  code: "INVALID_REQUEST" as const,
  supplied: [name, value],
}));

const rejectedCall = fc.oneof(unknownDisk, badShape, extraKey, badAgent, badListArgs, unknownTool);

describe("Feature: crew-app, Property 28: Rejected tool calls leave the Store unchanged", () => {
  it("returns a structured error that echoes nothing, and the Store files are byte-for-byte unchanged", () => {
    fc.assert(
      fc.property(rejectedCall, (c) => {
        const dir = mkdtempSync(join(tmpdir(), "rejected-prop-"));
        try {
          const store = createStore(dir);
          const seeded = store.update((d) => {
            d.cards[DISK] = makeCard();
            d.annotations[DISK] = {
              summary: { text: "existing", savedAt: "2024-01-02T00:00:00.000Z", agent: "exhume-archivist" },
              notes: [{ id: "n1", text: "kept", savedAt: "2024-01-03T00:00:00.000Z", agent: "exhume-undertaker" }],
            };
          });
          if (!seeded.ok) return false;
          const before = snapshot(dir);

          const res = callTool(store, c.name, c.args);

          if (!res.isError) return false;
          const text = res.content[0]?.text ?? "";
          let body: { error?: unknown };
          try {
            body = JSON.parse(text) as { error?: unknown };
          } catch {
            return false;
          }
          if (body.error !== c.code) return false;
          if (c.supplied.some((s) => text.includes(s))) return false;
          return snapshot(dir) === before;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);
});
