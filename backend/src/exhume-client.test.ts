/**
 * Integration tests for the stdio Exhume client.
 *
 * Most tests drive `backend/test-fixtures/exhume-stub.mjs`, a stub that speaks
 * the same line protocol and is told what to do through `behavior.json` in
 * the root folder. One test runs the real pinned server on `demo-library/`.
 *
 * Requirements 2.5, 2.7, 2.8, 5.7, 5.8.
 * Every wait is a counted loop with a hard cap; every child is SIGKILLed on
 * cleanup and the stub carries its own hard timer.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExhumeClientError,
  ExhumeToolError,
  StdioExhumeClient,
  type Timeouts,
} from "./exhume-client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const stubScript = path.join(here, "..", "test-fixtures", "exhume-stub.mjs");
const demoLibrary = path.join(appRoot, "demo-library");

const SHORT: Partial<Timeouts> = { handshake: 1500, open_disk: 400, read_grave: 400, exhume: 400 };

interface Behavior {
  handshake?: "ok" | "hang" | "exit" | "garbage";
  calls?: string[];
}

let root = "";
const clients: StdioExhumeClient[] = [];

function setBehavior(b: Behavior): void {
  writeFileSync(path.join(root, "behavior.json"), JSON.stringify(b));
}

function pids(): number[] {
  let text = "";
  try {
    text = readFileSync(path.join(root, "pids.txt"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => /^\d+$/.test(l))
    .map(Number);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls `check` in a capped loop (at most `steps` x 25 ms). */
async function waitFor(check: () => boolean, steps = 200): Promise<boolean> {
  for (let i = 0; i < steps; i++) {
    if (check()) return true;
    await new Promise<void>((r) => setTimeout(r, 25));
  }
  return check();
}

function stubClient(timeouts: Partial<Timeouts> = SHORT): StdioExhumeClient {
  const c = new StdioExhumeClient({
    appRoot,
    libraryRoot: root,
    serverScript: stubScript,
    timeouts,
  });
  clients.push(c);
  return c;
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  return undefined;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "exhume-client-"));
  setBehavior({});
});

afterEach(() => {
  for (const c of clients.splice(0, clients.length)) c.close();
  for (const pid of pids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(root, { recursive: true, force: true });
});

describe("stub server: handshake and answers", () => {
  it("completes the handshake and answers all three tools", async () => {
    const c = stubClient();
    const report = await c.openDisk("a.img");
    expect(report.volume.label).toBe("STUB");
    expect(report.entries).toHaveLength(1);
    const grave = await c.readGrave("a.img", "A.TXT", 0);
    expect(grave.format).toBe("text");
    const out = await c.exhume("a.img", "A.TXT", 0);
    expect(out.bytes).toBe(5);
    // One child served every call.
    expect(c.spawnCount).toBe(1);
    expect(pids()).toHaveLength(1);
  });

  it("serialises concurrent calls through one queue", async () => {
    const c = stubClient();
    const results = await Promise.all([c.openDisk("a.img"), c.openDisk("b.img"), c.openDisk("c.img")]);
    expect(results).toHaveLength(3);
    expect(c.spawnCount).toBe(1);
  });

  it("fails with EXHUME_UNAVAILABLE when the handshake hangs, and kills the child", async () => {
    setBehavior({ handshake: "hang" });
    const c = stubClient({ ...SHORT, handshake: 300 });
    const err = await rejection(c.openDisk("a.img"));
    expect(err).toBeInstanceOf(ExhumeClientError);
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
    const list = pids();
    expect(list).toHaveLength(1);
    expect(await waitFor(() => !alive(list[0] as number))).toBe(true);
  });

  it("fails with EXHUME_UNAVAILABLE when the child exits during the handshake", async () => {
    setBehavior({ handshake: "exit" });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
  });

  it("fails with EXHUME_UNAVAILABLE when the handshake reply is not JSON", async () => {
    setBehavior({ handshake: "garbage" });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
  });

  it("fails with EXHUME_UNAVAILABLE when the server script does not exist", async () => {
    const c = new StdioExhumeClient({
      appRoot,
      libraryRoot: root,
      serverScript: path.join(root, "missing.mjs"),
      timeouts: SHORT,
    });
    clients.push(c);
    const err = await rejection(c.openDisk("a.img"));
    expect(err).toBeInstanceOf(ExhumeClientError);
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
  });
});

describe("stub server: tool errors", () => {
  it("maps isError results to ExhumeToolError with the fixed code and keeps the child", async () => {
    setBehavior({ calls: ["error", "answer"] });
    const c = stubClient();
    const err = await rejection(c.readGrave("a.img", "A.TXT", 0));
    expect(err).toBeInstanceOf(ExhumeToolError);
    expect((err as ExhumeToolError).code).toBe("GRAVE_NOT_READABLE");
    expect((err as ExhumeToolError).message).toBe("Fixed stub message.");
    const report = await c.openDisk("a.img");
    expect(report.volume.label).toBe("STUB");
    expect(c.spawnCount).toBe(1);
  });

  it("rejects a result of the wrong shape as EXHUME_UNAVAILABLE and replaces the child", async () => {
    setBehavior({ calls: ["badshape", "answer"] });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
    const report = await c.openDisk("a.img");
    expect(report.volume.label).toBe("STUB");
    expect(c.spawnCount).toBe(2);
  });

  it("treats a non-JSON line from the child as EXHUME_UNAVAILABLE and recovers", async () => {
    setBehavior({ calls: ["garbage", "answer"] });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
    await expect(c.openDisk("a.img")).resolves.toBeDefined();
    expect(c.spawnCount).toBe(2);
  });
});

describe("stub server: timeout kill and restart", () => {
  it("kills a hung child on timeout and restarts lazily on the next call", async () => {
    setBehavior({ calls: ["hang", "answer"] });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect(err).toBeInstanceOf(ExhumeClientError);
    expect((err as ExhumeClientError).code).toBe("EXHUME_TIMEOUT");

    const first = pids();
    expect(first).toHaveLength(1);
    expect(await waitFor(() => !alive(first[0] as number))).toBe(true);

    const report = await c.openDisk("a.img");
    expect(report.volume.label).toBe("STUB");
    expect(c.spawnCount).toBe(2);
    const all = pids();
    expect(all).toHaveLength(2);
    expect(all[1]).not.toBe(all[0]);
  });

  it("applies the per-tool timeout to read_grave and exhume", async () => {
    setBehavior({ calls: ["hang", "hang"] });
    const c = stubClient();
    const a = await rejection(c.readGrave("a.img", "A.TXT", 0));
    expect((a as ExhumeClientError).code).toBe("EXHUME_TIMEOUT");
    const b = await rejection(c.exhume("a.img", "A.TXT", 0));
    expect((b as ExhumeClientError).code).toBe("EXHUME_TIMEOUT");
  });

  it("does not let a hung call block later queued calls forever", async () => {
    setBehavior({ calls: ["hang", "answer"] });
    const c = stubClient();
    const first = rejection(c.openDisk("a.img"));
    const second = c.openDisk("b.img");
    expect(((await first) as ExhumeClientError).code).toBe("EXHUME_TIMEOUT");
    await expect(second).resolves.toBeDefined();
  });
});

describe("stub server: process exit", () => {
  it("reports EXHUME_UNAVAILABLE when the child exits mid-call and restarts on the next call", async () => {
    setBehavior({ calls: ["exit", "answer"] });
    const c = stubClient();
    const err = await rejection(c.openDisk("a.img"));
    expect(err).toBeInstanceOf(ExhumeClientError);
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
    const report = await c.openDisk("a.img");
    expect(report.volume.label).toBe("STUB");
    expect(c.spawnCount).toBe(2);
  });

  it("restart() drops the child and the next call starts a new one", async () => {
    const c = stubClient();
    await c.openDisk("a.img");
    const first = pids();
    await c.restart(root);
    expect(await waitFor(() => !alive(first[0] as number))).toBe(true);
    await c.openDisk("a.img");
    expect(c.spawnCount).toBe(2);
  });

  it("close() kills the child and later calls fail with EXHUME_UNAVAILABLE", async () => {
    const c = stubClient();
    await c.openDisk("a.img");
    const first = pids();
    c.close();
    expect(await waitFor(() => !alive(first[0] as number))).toBe(true);
    const err = await rejection(c.openDisk("a.img"));
    expect((err as ExhumeClientError).code).toBe("EXHUME_UNAVAILABLE");
  });
});

describe("spawn rules", () => {
  it("spawns with --root only and without a shell", () => {
    const source = readFileSync(path.join(here, "exhume-client.ts"), "utf8");
    expect(source).toContain('[scriptPath, "--root", libraryRoot]');
    expect(source).toContain("shell: false");
  });
});

describe("real pinned server on demo-library", () => {
  it("opens a demo disk and reads a file, then closes cleanly", async () => {
    const c = new StdioExhumeClient({
      appRoot,
      libraryRoot: demoLibrary,
      timeouts: { handshake: 10_000, open_disk: 20_000, read_grave: 10_000 },
    });
    clients.push(c);
    const report = await c.openDisk("writers-disk.img");
    expect(report.untrusted).toBe(true);
    expect(report.entries.length).toBeGreaterThan(0);
    const readable = report.entries.find((e) => e.kind === "file" && (e.state === "alive" || e.state === "recovered"));
    expect(readable).toBeDefined();
    if (readable !== undefined) {
      const grave = await c.readGrave("writers-disk.img", readable.path, readable.id);
      expect(grave.grave.id).toBe(readable.id);
    }
    // A path outside the root is refused by the real server with a fixed code.
    const err = await rejection(c.openDisk("../README.md"));
    expect(err).toBeInstanceOf(ExhumeToolError);
    expect((err as ExhumeToolError).code).toBe("PATH_REJECTED");
    c.close();
  }, 60_000);
});

describe("stub script runs standalone", () => {
  it("answers an initialize line when driven with spawnSync", () => {
    const res = spawnSync(process.execPath, [stubScript, "--root", root], {
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
      timeout: 5000,
      killSignal: "SIGKILL",
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const line = res.stdout.split("\n")[0] ?? "";
    const msg: unknown = JSON.parse(line);
    expect(msg).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18" } });
  });
});
