import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { createStore } from "../../src/shared/store";
import { ExhumeClientError, ExhumeToolError } from "./exhume-client.js";
import type { ExhumeClient, OpenDiskReport, ReadGraveResult } from "./exhume-client.js";
import { Scanner } from "./scanner";
import type { Timers } from "./scanner";

// Feature: crew-app, Property 14: Exhume failures during a scan are isolated
// **Validates: Requirements 2.8, 5.7, 5.8**

type Outcome = "success" | "tool-error" | "timeout" | "exit";

const outcomesArb = fc.array(fc.constantFrom<Outcome>("success", "tool-error", "timeout", "exit"), {
  minLength: 1,
  maxLength: 6,
});

function report(): OpenDiskReport {
  return {
    untrusted: true,
    volume: { label: "DISK", geometrySource: "bpb" },
    totalEntries: 1,
    counts: { alive: 1, recovered: 0, partial: 0, lost: 0 },
    entries: [{ id: 1, path: "A.TXT", kind: "file", state: "alive", size: 3, date: "1990-01-01T00:00:00" }],
    truncated: false,
    warnings: [],
    warningsOmitted: 0,
  };
}

/** In-memory client: the outcome of `open_disk` is scripted per image path. */
class ScriptedClient implements ExhumeClient {
  events: string[] = [];
  constructor(private readonly script: ReadonlyMap<string, Outcome>) {}
  openDisk(image: string): Promise<OpenDiskReport> {
    this.events.push(`open:${image}`);
    const outcome = this.script.get(image) ?? "success";
    if (outcome === "exit") return Promise.reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
    if (outcome === "timeout") return Promise.reject(new ExhumeClientError("EXHUME_TIMEOUT"));
    if (outcome === "tool-error") return Promise.reject(new ExhumeToolError("DISK_UNREADABLE", "unreadable"));
    return Promise.resolve(report());
  }
  readGrave(): Promise<ReadGraveResult> {
    return Promise.resolve({
      grave: { id: 1, path: "A.TXT", state: "alive" },
      format: "text",
      mime: "text/plain",
      extension: "txt",
      text: "x",
      totalChars: 1,
      truncated: false,
      warnings: [],
      warningsOmitted: 0,
    } as unknown as ReadGraveResult);
  }
  exhume(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  restart(): Promise<void> {
    this.events.push("restart");
    return Promise.resolve();
  }
  close(): void {}
}

const noTimers: Timers = { setTimeout: () => 0, clearTimeout: () => undefined };

async function runCase(outcomes: readonly Outcome[]): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), "scan-fail-"));
  try {
    const lib = path.join(dir, "lib");
    mkdirSync(lib, { recursive: true });
    const script = new Map<string, Outcome>();
    outcomes.forEach((o, i) => {
      const name = `disk${i}.img`;
      // Distinct bytes give distinct Disk_Ids.
      const bytes = Buffer.alloc(512, 0);
      bytes.writeUInt32BE(i + 1, 0);
      writeFileSync(path.join(lib, name), bytes);
      script.set(name, o);
    });

    const client = new ScriptedClient(script);
    const store = createStore(path.join(dir, "data"));
    const scanner = new Scanner({ client, store, root: lib, timers: noTimers });
    scanner.triggerScan();
    await scanner.idle();

    if (scanner.getStatus().state !== "idle") return false;
    const read = store.read();
    if (!read.ok) return false;
    const data = read.value;
    if (Object.keys(data.cards).length !== outcomes.length) return false;

    for (const [name, outcome] of script) {
      const id = data.paths[name]?.diskId;
      const card = id === undefined ? undefined : data.cards[id];
      if (card === undefined) return false;
      if (outcome === "success") {
        if (card.status !== "catalogued" || card.fileCount !== 1 || card.label !== "DISK") return false;
        if (card.warnings.length !== 0) return false;
      } else {
        const codes = card.warnings.map((w) => w.code);
        const expected = outcome === "timeout" ? "EXHUME_TIMEOUT" : "EXHUME_FAILED";
        if (!codes.includes(expected)) return false;
        if (card.status !== "new" || card.fileCount !== 0 || card.totalEntries !== 0 || card.label !== "") {
          return false;
        }
      }
    }

    // After a process exit the client restarts before the next image is opened.
    const opens = client.events.filter((e) => e.startsWith("open:"));
    for (let i = 0; i < client.events.length; i++) {
      const ev = client.events[i];
      if (ev === undefined || !ev.startsWith("open:")) continue;
      const o = script.get(ev.slice(5));
      if (o === "exit" && client.events[i + 1] !== "restart") return false;
    }
    const exits = [...script.values()].filter((o) => o === "exit").length;
    if (client.events.filter((e) => e === "restart").length < exits) return false;
    return opens.length === outcomes.length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Property 14: Exhume failures during a scan are isolated", () => {
  it("every failed image gets a warning card and every other image a complete card", async () => {
    await fc.assert(
      fc.asyncProperty(outcomesArb, (outcomes) => runCase(outcomes)),
      { numRuns: 100 },
    );
  }, 120_000);
});
