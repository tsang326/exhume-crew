import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../../src/shared/store";
import { ExhumeClientError } from "./exhume-client.js";
import type { ExhumeClient, OpenDiskReport, ReadGraveResult } from "./exhume-client.js";
import { Scanner } from "./scanner";
import type { Timers, WatchFn } from "./scanner";

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

class FakeClient implements ExhumeClient {
  opens: string[] = [];
  restarts = 0;
  failNext: "exit" | "timeout" | null = null;
  openDisk(image: string): Promise<OpenDiskReport> {
    this.opens.push(image);
    const f = this.failNext;
    if (f !== null) {
      this.failNext = null;
      return Promise.reject(new ExhumeClientError(f === "exit" ? "EXHUME_UNAVAILABLE" : "EXHUME_TIMEOUT"));
    }
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
    this.restarts++;
    return Promise.resolve();
  }
  close(): void {}
}

const noTimers: Timers = { setTimeout: () => 0, clearTimeout: () => undefined };

describe("Scanner orchestration", () => {
  let dir: string;
  let lib: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scan-"));
    lib = path.join(dir, "lib");
    mkdirSync(path.join(lib, "exhumed"), { recursive: true });
    writeFileSync(path.join(lib, "a.img"), Buffer.alloc(512, 1));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function make(client: FakeClient): { scanner: Scanner; store: ReturnType<typeof createStore> } {
    const store = createStore(path.join(dir, "data"));
    return { scanner: new Scanner({ client, store, root: lib, timers: noTimers }), store };
  }

  it("catalogues, skips unchanged images and prunes vanished paths", async () => {
    const client = new FakeClient();
    const { scanner, store } = make(client);
    scanner.triggerScan();
    await scanner.idle();
    const first = store.read();
    expect(first.ok && Object.values(first.value.cards)[0]?.status).toBe("catalogued");
    expect(first.ok && Object.values(first.value.cards)[0]?.formats).toEqual(["text"]);
    expect(scanner.getStatus().state).toBe("idle");

    scanner.triggerScan();
    await scanner.idle();
    expect(client.opens).toHaveLength(1);

    rmSync(path.join(lib, "a.img"));
    scanner.triggerScan();
    await scanner.idle();
    const after = store.read();
    expect(after.ok && Object.keys(after.value.cards)).toEqual([]);
  });

  it("keeps first-seen when an image changes", async () => {
    const client = new FakeClient();
    const { scanner, store } = make(client);
    scanner.triggerScan();
    await scanner.idle();
    const before = store.read();
    const seen = before.ok ? before.value.paths["a.img"]?.firstSeen : undefined;
    writeFileSync(path.join(lib, "a.img"), Buffer.alloc(512, 2));
    scanner.triggerScan();
    await scanner.idle();
    const after = store.read();
    expect(client.opens).toHaveLength(2);
    expect(after.ok && after.value.paths["a.img"]?.firstSeen).toBe(seen);
    expect(after.ok && Object.keys(after.value.cards)).toHaveLength(1);
  });

  it("isolates an Exhume exit, warns and restarts the client", async () => {
    const client = new FakeClient();
    client.failNext = "exit";
    const { scanner, store } = make(client);
    scanner.triggerScan();
    await scanner.idle();
    const r = store.read();
    const card = r.ok ? Object.values(r.value.cards)[0] : undefined;
    expect(card?.status).toBe("new");
    expect(card?.warnings.map((w) => w.code)).toEqual(["EXHUME_FAILED", "EXHUME_RESTARTED"]);
    expect(card?.fileCount).toBe(0);
    expect(client.restarts).toBe(1);
    // A failed card is retried on the next scan.
    scanner.triggerScan();
    await scanner.idle();
    const r2 = store.read();
    expect(r2.ok && Object.values(r2.value.cards)[0]?.status).toBe("catalogued");
  });

  it("starts one scan at a time", async () => {
    const { scanner } = make(new FakeClient());
    expect(scanner.triggerScan()).toEqual({ started: true, running: true });
    expect(scanner.triggerScan()).toEqual({ started: false, running: true });
    await scanner.idle();
  });

  it("debounces watcher events, ignores exhumed and falls back to polling", async () => {
    const client = new FakeClient();
    const store = createStore(path.join(dir, "data"));
    const queue: Array<() => void> = [];
    const timers: Timers = {
      setTimeout: (fn) => {
        queue.push(fn);
        return queue.length - 1;
      },
      clearTimeout: (h) => {
        queue[h as number] = () => undefined;
      },
    };
    let emit: (n: string | null) => void = () => undefined;
    const watch: WatchFn = (_r, onChange) => {
      emit = onChange;
      return { close: () => undefined };
    };
    const scanner = new Scanner({ client, store, root: lib, timers, watch });
    scanner.startWatching();
    emit("exhumed/x.txt");
    expect(queue).toHaveLength(0);
    emit("a.img");
    emit("a.img");
    queue.forEach((f) => f());
    await scanner.idle();
    expect(client.opens).toHaveLength(1);
    scanner.stop();

    const failing: WatchFn = () => {
      throw new Error("no recursive watch");
    };
    queue.length = 0;
    const poller = new Scanner({ client, store, root: lib, timers, watch: failing, maxPolls: 2 });
    poller.startWatching();
    expect(queue).toHaveLength(1);
    poller.stop();
  });
});
