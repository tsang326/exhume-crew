import { createHash, createHmac } from "node:crypto";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DiskCard, FileEntry, ScanStatus } from "../../src/shared/schema";
import { createStore } from "../../src/shared/store";
import type { Store } from "../../src/shared/store";
import { ApiError } from "./errors";
import { ExhumeClientError } from "./exhume-client";
import type { ExhumeResult, ReadGraveResult } from "./exhume-client";
import type { LibraryStatus } from "./library";
import { createRoutes } from "./routes";
import type { LibraryPort, RouteDeps, ScannerPort } from "./routes";
import { createApiServer, listen } from "./server";

const SECRET = "test-secret-value";
const NOW_MS = 1_700_000_000_000;
const DISK_ID = "a".repeat(64);
const OTHER_ID = "b".repeat(64);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ------------------------------------------------------------------ fakes

interface Calls {
  readGrave: number;
  exhume: number;
  triggerScan: number;
  setLibrary: string[];
  copyDemo: string[];
  hashImage: number;
}

let calls: Calls;
let scanRunning = false;
let readGraveImpl: () => Promise<ReadGraveResult>;
let setLibraryImpl: (p: string) => Promise<LibraryStatus>;
let realPath: string | null;
let typedPath = "~/Exhume Library";
let libStatus: LibraryStatus;
let dataDir: string;
let libRoot: string;
let store: Store;
let server: Server;
let port: number;

function freshCalls(): Calls {
  return { readGrave: 0, exhume: 0, triggerScan: 0, setLibrary: [], copyDemo: [], hashImage: 0 };
}

const idleStatus: ScanStatus = {
  state: "idle",
  scanned: 2,
  total: 2,
  error: null,
  startedAt: "2024-01-01T00:00:00.000Z",
  finishedAt: "2024-01-01T00:00:01.000Z",
  libraryWarnings: [],
};

function card(diskId: string, relPath: string): DiskCard {
  return {
    diskId,
    relPath,
    label: "DISK",
    sizeBytes: 737280,
    geometry: { source: "bpb", label: "720 KB" },
    fileCount: 2,
    totalEntries: 2,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: ["text"],
    counts: { alive: 1, recovered: 1, partial: 0, lost: 0 },
    warnings: [],
    status: "catalogued",
    firstSeen: "2024-01-01T00:00:00.000Z",
  };
}

const entries: FileEntry[] = [
  { id: 1, path: "A.TXT", kind: "file", state: "alive", size: 3, date: null },
  { id: 2, path: "B.TXT", kind: "file", state: "recovered", size: 3, date: null },
  { id: 3, path: "C.TXT", kind: "file", state: "partial", size: 3, date: null },
];

function textGrave(text: string): ReadGraveResult {
  return {
    grave: { id: 1, path: "A.TXT", state: "alive" },
    format: "text",
    mime: "text/plain",
    extension: ".txt",
    text,
    totalChars: text.length,
    truncated: false,
    warnings: [],
    warningsOmitted: 0,
  };
}

function pngGrave(): ReadGraveResult {
  return {
    grave: { id: 1, path: "A.PNG", state: "alive" },
    format: "png",
    mime: "image/png",
    width: 16,
    height: 8,
    bytes: 123,
    warnings: [],
    warningsOmitted: 0,
  };
}

function buildDeps(): RouteDeps {
  const scanner: ScannerPort = {
    getStatus: () => (scanRunning ? { ...idleStatus, state: "running" } : idleStatus),
    triggerScan: () => {
      calls.triggerScan++;
      return scanRunning ? { started: false, running: true } : { started: true, running: true };
    },
  };
  const library: LibraryPort = {
    getStatus: () => libStatus,
    getRealPath: () => realPath,
    setLibrary: (p) => {
      calls.setLibrary.push(p);
      return setLibraryImpl(p);
    },
  };
  return {
    store,
    scanner,
    library,
    exhume: {
      readGrave: () => {
        calls.readGrave++;
        return readGraveImpl();
      },
      exhume: (): Promise<ExhumeResult> => {
        calls.exhume++;
        return Promise.resolve({
          path: "exhumed/x/A.TXT",
          bytes: 3,
          format: "text",
          mime: "text/plain",
          id: 1,
          state: "alive",
        });
      },
    },
    copyDemo: (p) => {
      calls.copyDemo.push(p);
      return Promise.resolve({ copied: ["a.img"], skipped: ["b.img"] });
    },
    hashImage: () => {
      calls.hashImage++;
      return Promise.resolve(DISK_ID);
    },
    clock: { now: () => NOW_MS },
  };
}

// ---------------------------------------------------------------- helpers

function sign(method: string, target: string, body: string, ts = Math.floor(NOW_MS / 1000)): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const mac = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${ts}:${method}:${target}:${bodyHash}`)
    .digest("hex");
  return `${ts}:${mac}`;
}

interface Reply {
  status: number;
  text: string;
  json: unknown;
  headers: Headers;
}

async function call(
  method: string,
  target: string,
  opts: { body?: string; header?: string | null; headerName?: string } = {},
): Promise<Reply> {
  const body = opts.body ?? "";
  const headers: Record<string, string> = {};
  if (opts.header !== null) headers[opts.headerName ?? "X-KiroCrew-Proxy"] = opts.header ?? sign(method, target, body);
  if (body !== "") headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${port}${target}`, {
    method,
    headers,
    ...(body !== "" ? { body } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function field(v: unknown, key: string): unknown {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
}

function seed(): void {
  const r = store.update((d) => {
    d.cards[DISK_ID] = card(DISK_ID, "one.img");
    d.paths["one.img"] = { diskId: DISK_ID, firstSeen: "2024-01-01T00:00:00.000Z" };
  });
  if (!r.ok) throw new Error("seed failed");
  const w = store.writeFiles(DISK_ID, {
    schemaVersion: 1,
    diskId: DISK_ID,
    totalEntries: entries.length,
    truncated: false,
    entries,
  });
  if (!w.ok) throw new Error("seed files failed");
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "routes-data-"));
  libRoot = mkdtempSync(path.join(tmpdir(), "routes-lib-"));
  store = createStore(dataDir);
  calls = freshCalls();
  const routes = createRoutes(buildDeps());
  server = createApiServer({ secret: SECRET, routes, now: () => NOW_MS });
  port = await listen(server, 0);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(libRoot, { recursive: true, force: true });
});

beforeEach(() => {
  calls = freshCalls();
  scanRunning = false;
  realPath = libRoot;
  typedPath = "~/Exhume Library";
  libStatus = { path: typedPath, error: null };
  readGraveImpl = () => Promise.resolve(textGrave("hello"));
  setLibraryImpl = (p) => Promise.resolve({ path: p, error: null });
  store.update((d) => {
    d.cards = {};
    d.paths = {};
    d.annotations = {};
    d.exhumed = {};
  });
  seed();
});

// ------------------------------------------------------------------ tests

describe("route table (Requirement 7.1)", () => {
  it("has exactly the eleven operations", () => {
    const table = createRoutes(buildDeps()).map((r) => `${r.method} /${r.pattern.join("/")}`);
    expect(table.sort()).toEqual(
      [
        "GET /api/library",
        "PUT /api/library",
        "POST /api/library/demo",
        "GET /api/scan",
        "POST /api/scan",
        "GET /api/disks",
        "GET /api/disks/:id",
        "GET /api/disks/:id/preview",
        "POST /api/disks/:id/exhume-all",
        "GET /api/export/csv",
        "GET /api/export/markdown",
      ].sort(),
    );
  });
});

describe("health and signatures", () => {
  it("/health answers 200 {\"ok\":true} without a signature", async () => {
    const r = await call("GET", "/health", { header: null });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts both header names", async () => {
    for (const headerName of ["X-KiroCrew-Proxy", "X-Crew-Proxy"]) {
      const r = await call("GET", "/api/scan", { headerName });
      expect(r.status).toBe(200);
    }
  });

  it("answers 401 for every Page_API route without a valid signature and performs no action", async () => {
    const routes = createRoutes(buildDeps());
    const concrete: Array<[string, string, string]> = routes.map((r) => {
      const target =
        "/" +
        r.pattern.map((s) => (s === ":id" ? DISK_ID : s)).join("/") +
        (r.query.includes("entry") ? "?entry=1" : "");
      return [r.method, target, r.method === "PUT" ? JSON.stringify({ path: "/tmp/x" }) : ""];
    });
    expect(concrete).toHaveLength(11);
    const stale = Math.floor(NOW_MS / 1000) - 3600;
    for (const [method, target, body] of concrete) {
      const variants: Array<string | null> = [
        null,
        "garbage",
        `${Math.floor(NOW_MS / 1000)}:${"0".repeat(64)}`,
        sign(method, target, body, stale),
      ];
      for (const header of variants) {
        const r = await call(method, target, { body, header });
        expect(r.status).toBe(401);
      }
    }
    expect(calls).toEqual(freshCalls());
    // The catalogue was not touched either.
    const data = store.read();
    expect(data.ok && Object.keys(data.value.exhumed).length).toBe(0);
  });
});

describe("preview", () => {
  const url = (entry: number): string => `/api/disks/${DISK_ID}/preview?entry=${entry}`;

  it("returns text previews", async () => {
    const r = await call("GET", url(1));
    expect(r.status).toBe(200);
    expect(field(r.json, "kind")).toBe("text");
    expect(field(r.json, "text")).toBe("hello");
    expect(field(r.json, "truncated")).toBe(false);
  });

  it("gives 502 for an unavailable Exhume server with no partial content", async () => {
    readGraveImpl = () => Promise.reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
    const r = await call("GET", url(1));
    expect(r.status).toBe(502);
    expect(field(r.json, "text")).toBeUndefined();
    expect(field(field(r.json, "error"), "code")).toBe("PREVIEW_UNAVAILABLE");
  });

  it("gives 504 for a timeout with no partial content", async () => {
    readGraveImpl = () => Promise.reject(new ExhumeClientError("EXHUME_TIMEOUT"));
    const r = await call("GET", url(1));
    expect(r.status).toBe(504);
    expect(field(r.json, "text")).toBeUndefined();
  });

  it("returns PNG facts and null imageDataUrl when the entry was not exhumed", async () => {
    readGraveImpl = () => Promise.resolve(pngGrave());
    const r = await call("GET", url(1));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: "png", width: 16, height: 8, bytes: 123, imageDataUrl: null });
  });

  describe("PNG data URL", () => {
    function record(outputPath: string): void {
      store.update((d) => {
        d.exhumed[DISK_ID] = { "1": { outputPath, at: "2024-01-01T00:00:00.000Z" } };
      });
    }
    function writePng(rel: string, bytes: Buffer): void {
      const abs = path.join(libRoot, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }

    it("gives a data URL for an earlier exhumed PNG inside exhumed/", async () => {
      readGraveImpl = () => Promise.resolve(pngGrave());
      const png = Buffer.concat([PNG_SIG, Buffer.from("rest-of-image")]);
      writePng("exhumed/d/A.PNG", png);
      record("exhumed/d/A.PNG");
      const r = await call("GET", url(1));
      expect(field(r.json, "imageDataUrl")).toBe(`data:image/png;base64,${png.toString("base64")}`);
    });

    it("gives null when the file is over 1.5 MB, not a PNG, missing, or outside exhumed/", async () => {
      readGraveImpl = () => Promise.resolve(pngGrave());
      writePng("exhumed/d/big.png", Buffer.concat([PNG_SIG, Buffer.alloc(1_500_001)]));
      writePng("exhumed/d/fake.png", Buffer.from("not a png at all"));
      writePng("outside.png", Buffer.concat([PNG_SIG, Buffer.from("x")]));
      for (const p of ["exhumed/d/big.png", "exhumed/d/fake.png", "exhumed/d/missing.png", "outside.png", "exhumed/../outside.png"]) {
        record(p);
        const r = await call("GET", url(1));
        expect(r.status).toBe(200);
        expect(field(r.json, "imageDataUrl")).toBeNull();
      }
    });
  });
});

describe("status shapes", () => {
  it("scan status has the ScanStatus fields", async () => {
    const r = await call("GET", "/api/scan");
    expect(r.status).toBe(200);
    expect(r.json).toEqual(idleStatus);
  });

  it("library status has path and error", async () => {
    const r = await call("GET", "/api/library");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ path: typedPath, error: null });
  });

  it("library status reports a fixed error code and message", async () => {
    libStatus = { path: "/nope", error: { code: "LIBRARY_NOT_FOUND", message: "That folder was not found." } };
    const r = await call("GET", "/api/library");
    expect(r.json).toEqual({ path: "/nope", error: { code: "LIBRARY_NOT_FOUND", message: "That folder was not found." } });
  });
});

describe("set library path", () => {
  const put = (body: string): Promise<Reply> => call("PUT", "/api/library", { body });

  it("accepts a valid path", async () => {
    const r = await put(JSON.stringify({ path: "/some/where" }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ path: "/some/where", error: null });
    expect(calls.setLibrary).toEqual(["/some/where"]);
  });

  it("answers 400 for malformed bodies without calling the manager", async () => {
    const bad = [
      "not json",
      "[]",
      "null",
      JSON.stringify({}),
      JSON.stringify({ path: 5 }),
      JSON.stringify({ path: "" }),
      JSON.stringify({ path: "   " }),
      JSON.stringify({ path: "a".repeat(4097) }),
    ];
    for (const b of bad) {
      const r = await put(b);
      expect(r.status).toBe(400);
      expect(field(field(r.json, "error"), "code")).toBe("BAD_REQUEST");
    }
    expect(calls.setLibrary).toEqual([]);
  });

  it("answers 400 with the fixed error for a rejected path and keeps no path in the message", async () => {
    setLibraryImpl = () => Promise.reject(new ApiError("LIBRARY_NOT_FOUND", 400));
    const r = await put(JSON.stringify({ path: "/secret/place" }));
    expect(r.status).toBe(400);
    expect(field(field(r.json, "error"), "code")).toBe("LIBRARY_NOT_FOUND");
    expect(r.text).not.toContain("/secret/place");
  });
});

describe("use demo library", () => {
  it("activates the library when none is valid yet", async () => {
    realPath = null;
    const r = await call("POST", "/api/library/demo");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ copied: ["a.img"], skipped: ["b.img"] });
    expect(calls.copyDemo).toEqual([typedPath]);
    expect(calls.setLibrary).toEqual([typedPath]);
  });

  it("triggers a scan when a library is already active", async () => {
    const r = await call("POST", "/api/library/demo");
    expect(r.status).toBe(200);
    expect(calls.setLibrary).toEqual([]);
    expect(calls.triggerScan).toBe(1);
  });

  it("reports a copy failure as an error without leaking paths", async () => {
    const routes = createRoutes({
      ...buildDeps(),
      copyDemo: () => Promise.reject(new ApiError("DEMO_COPY_FAILED", 500)),
    });
    const s = createApiServer({ secret: SECRET, routes, now: () => NOW_MS });
    const p = await listen(s, 0);
    try {
      const target = "/api/library/demo";
      const res = await fetch(`http://127.0.0.1:${p}${target}`, {
        method: "POST",
        headers: { "X-Crew-Proxy": sign("POST", target, "") },
      });
      expect(res.status).toBe(500);
      const body: unknown = await res.json();
      expect(field(field(body, "error"), "code")).toBe("DEMO_COPY_FAILED");
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});

describe("rescan", () => {
  it("starts a scan when idle", async () => {
    const r = await call("POST", "/api/scan");
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ started: true, running: true });
  });

  it("does not start a second scan while one is running", async () => {
    scanRunning = true;
    const r = await call("POST", "/api/scan");
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ started: false, running: true });
    const s = await call("GET", "/api/scan");
    expect(field(s.json, "state")).toBe("running");
  });
});
