/**
 * Feature: crew-app, Property 9: Discovery classifies every entry and never throws
 * **Validates: Requirements 3.7, 3.8, 3.9, 18.5, 19.4**
 *
 * Plus a hostile-library stress test that runs the whole Scanner against an
 * in-memory fake Exhume client. No process is spawned here; all loops are counted.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { displayName } from "../../src/shared/sanitize";
import { createStore } from "../../src/shared/store";
import type { ExhumeClient, OpenDiskReport, ReadGraveResult } from "./exhume-client.js";
import { discoverImages, hashCandidate, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, Scanner } from "./scanner";
import type { Timers } from "./scanner";

const HOSTILE_KINDS = [
  "empty",
  "oversize",
  "badsize",
  "badext",
  "symfile",
  "symdir",
  "symout",
  "ctrl",
] as const;
type HostileKind = (typeof HOSTILE_KINDS)[number];

const EXPECTED_CODE: Record<HostileKind, string> = {
  empty: "NOT_A_DISK_IMAGE",
  oversize: "TOO_LARGE",
  badsize: "NOT_A_DISK_IMAGE",
  badext: "NOT_A_DISK_IMAGE",
  symfile: "SYMLINK_SKIPPED",
  symdir: "SYMLINK_SKIPPED",
  symout: "SYMLINK_SKIPPED",
  ctrl: "NAME_CONTROL_CHARS",
};

const MAX_ENTRIES_PER_CASE = 12;
const tempDirs: string[] = [];

function makeTemp(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "disc-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (let i = 0; i < tempDirs.length; i++) {
    const dir = tempDirs[i];
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function validImage(tag: number, sectors: number): Buffer {
  const buf = Buffer.alloc(512 * sectors, 0x5a);
  buf.writeUInt32LE(tag, 0);
  return buf;
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface Spec {
  valid: Array<{ sectors: number; ext: string; upper: boolean; nested: boolean }>;
  hostile: Array<{ kind: HostileKind; nested: boolean }>;
  junk: number;
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  valid: fc.array(
    fc.record({
      sectors: fc.integer({ min: 1, max: 4 }),
      ext: fc.constantFrom(...IMAGE_EXTENSIONS),
      upper: fc.boolean(),
      nested: fc.boolean(),
    }),
    { maxLength: MAX_ENTRIES_PER_CASE },
  ),
  hostile: fc.array(
    fc.record({ kind: fc.constantFrom(...HOSTILE_KINDS), nested: fc.boolean() }),
    { maxLength: MAX_ENTRIES_PER_CASE },
  ),
  junk: fc.integer({ min: 0, max: 4 }),
});

interface Built {
  root: string;
  outside: string;
  validRel: Map<string, string>; // relPath -> sha256
  hostileRel: Array<{ rel: string; kind: HostileKind }>;
}

function build(spec: Spec): Built {
  const base = makeTemp();
  const root = path.join(base, "lib");
  const outside = path.join(base, "outside");
  mkdirSync(path.join(root, "sub"), { recursive: true });
  mkdirSync(path.join(root, "exhumed", "deep"), { recursive: true });
  mkdirSync(path.join(outside, "dir"), { recursive: true });
  writeFileSync(path.join(outside, "secret.img"), validImage(999_999, 1));
  writeFileSync(path.join(root, "target.img"), validImage(777_777, 1)); // a valid image too

  const validRel = new Map<string, string>();
  validRel.set("target.img", sha(validImage(777_777, 1)));

  for (let i = 0; i < spec.valid.length && i < MAX_ENTRIES_PER_CASE; i++) {
    const v = spec.valid[i];
    if (v === undefined) continue;
    const ext = v.upper ? v.ext.toUpperCase() : v.ext;
    const rel = `${v.nested ? "sub/" : ""}v${i}${ext}`;
    const buf = validImage(i + 1, v.sectors);
    writeFileSync(path.join(root, ...rel.split("/")), buf);
    validRel.set(rel, sha(buf));
  }

  const hostileRel: Built["hostileRel"] = [];
  for (let i = 0; i < spec.hostile.length && i < MAX_ENTRIES_PER_CASE; i++) {
    const h = spec.hostile[i];
    if (h === undefined) continue;
    const dirPrefix = h.nested ? "sub/" : "";
    const name = h.kind === "ctrl" ? `h${i}\u0001\u0007x.img` : `h${i}${h.kind === "badext" ? ".txt" : ".img"}`;
    const rel = `${dirPrefix}${name}`;
    const abs = path.join(root, ...rel.split("/"));
    switch (h.kind) {
      case "empty":
        writeFileSync(abs, Buffer.alloc(0));
        break;
      case "oversize":
        writeFileSync(abs, Buffer.alloc(0));
        truncateSync(abs, MAX_IMAGE_BYTES + 512); // sparse
        break;
      case "badsize":
        writeFileSync(abs, Buffer.alloc(513, 1));
        break;
      case "badext":
        writeFileSync(abs, Buffer.alloc(512, 1));
        break;
      case "symfile":
        symlinkSync(path.join(root, "target.img"), abs);
        break;
      case "symdir":
        symlinkSync(path.join(outside, "dir"), abs);
        break;
      case "symout":
        symlinkSync(path.join(outside, "secret.img"), abs);
        break;
      case "ctrl":
        writeFileSync(abs, validImage(500_000 + i, 1));
        break;
    }
    hostileRel.push({ rel, kind: h.kind });
  }

  // Arbitrary junk inside exhumed/: valid-looking images, control names, symlinks.
  for (let i = 0; i < spec.junk; i++) {
    writeFileSync(path.join(root, "exhumed", `j${i}.img`), validImage(300_000 + i, 1));
    writeFileSync(path.join(root, "exhumed", "deep", `j\u0002${i}.img`), Buffer.alloc(3));
    symlinkSync(path.join(outside, "secret.img"), path.join(root, "exhumed", `s${i}.img`));
  }
  return { root, outside, validRel, hostileRel };
}

/** Returns a list of violated expectations; empty means the property holds. */
async function check(spec: Spec): Promise<string[]> {
  const problems: string[] = [];
  const built = build(spec);
  let result;
  try {
    result = await discoverImages(built.root);
  } catch (err) {
    return [`discoverImages threw: ${String(err)}`];
  }

  const got = result.candidates.map((c) => c.relPath).sort();
  const want = [...built.validRel.keys()].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`candidates ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }

  // Each hostile entry has at least one warning with the right code and its relative path.
  for (const h of built.hostileRel) {
    const shown = displayName(h.rel);
    const hit = result.warnings.some((w) => w.path === shown && w.code === EXPECTED_CODE[h.kind]);
    if (!hit) problems.push(`no ${EXPECTED_CODE[h.kind]} warning for ${shown}`);
  }

  // Nothing for exhumed/, and no absolute paths anywhere.
  const base = path.dirname(built.root);
  for (const w of result.warnings) {
    const p = w.path ?? "";
    if (p.startsWith("exhumed")) problems.push(`warning for exhumed entry ${p}`);
    if (p.includes(base) || w.message.includes(base) || path.isAbsolute(p)) {
      problems.push(`absolute path leaked: ${p}`);
    }
  }

  // Every candidate hashes (never throws) to the expected digest.
  for (const c of result.candidates) {
    let outcome;
    try {
      outcome = await hashCandidate(built.root, c);
    } catch (err) {
      problems.push(`hashCandidate threw: ${String(err)}`);
      continue;
    }
    if (!outcome.ok || outcome.image.sha256 !== built.validRel.get(c.relPath)) {
      problems.push(`bad hash for ${c.relPath}`);
    }
  }
  return problems;
}

describe("Property 9: Discovery classifies every entry and never throws", () => {
  it("Feature: crew-app, Property 9: Discovery classifies every entry and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const problems = await check(spec);
        return problems.length === 0;
      }),
      { numRuns: 100 },
    );
  });
});

// ------------------------------------------------------------------
// Hostile-library stress test through the Scanner
// ------------------------------------------------------------------

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
  openDisk(): Promise<OpenDiskReport> {
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
    return Promise.resolve();
  }
  close(): void {}
}

const noTimers: Timers = { setTimeout: () => 0, clearTimeout: () => undefined };

describe("hostile library stress test", () => {
  it("completes, warns for every hostile entry and catalogues every valid image", async () => {
    const base = makeTemp();
    const root = path.join(base, "lib");
    const outside = path.join(base, "outside");
    mkdirSync(path.join(root, "exhumed", "deep"), { recursive: true });
    mkdirSync(path.join(root, "disks"), { recursive: true });
    mkdirSync(path.join(outside, "dir"), { recursive: true });
    writeFileSync(path.join(outside, "secret.img"), validImage(999, 1));

    // Valid images, all distinct.
    const validPaths = ["one.img", "two.IMA", "disks/three.dsk", "disks/four.vfd", "five.flp"];
    for (let i = 0; i < validPaths.length; i++) {
      const rel = validPaths[i];
      if (rel !== undefined) writeFileSync(path.join(root, ...rel.split("/")), validImage(i + 1, 2));
    }

    // Hostile entries.
    writeFileSync(path.join(root, "empty.img"), Buffer.alloc(0));
    writeFileSync(path.join(root, "oversize.img"), Buffer.alloc(0));
    truncateSync(path.join(root, "oversize.img"), MAX_IMAGE_BYTES + 512);
    writeFileSync(path.join(root, "notes.txt"), Buffer.alloc(512, 1));
    writeFileSync(path.join(root, "odd.img"), Buffer.alloc(700, 1));
    writeFileSync(path.join(root, "ctrl\u0001name.img"), validImage(50, 1));
    symlinkSync(path.join(root, "one.img"), path.join(root, "link-inside.img"));
    symlinkSync(path.join(outside, "secret.img"), path.join(root, "link-outside.img"));
    symlinkSync(path.join(outside, "dir"), path.join(root, "link-dir"));
    symlinkSync(path.join(root, "nowhere.img"), path.join(root, "dangling.img"));
    const hostile: Array<[string, string]> = [
      ["empty.img", "NOT_A_DISK_IMAGE"],
      ["oversize.img", "TOO_LARGE"],
      ["notes.txt", "NOT_A_DISK_IMAGE"],
      ["odd.img", "NOT_A_DISK_IMAGE"],
      ["ctrl\u0001name.img", "NAME_CONTROL_CHARS"],
      ["link-inside.img", "SYMLINK_SKIPPED"],
      ["link-outside.img", "SYMLINK_SKIPPED"],
      ["link-dir", "SYMLINK_SKIPPED"],
      ["dangling.img", "SYMLINK_SKIPPED"],
    ];

    // Junk inside exhumed/ must produce nothing.
    writeFileSync(path.join(root, "exhumed", "junk.img"), validImage(60, 1));
    writeFileSync(path.join(root, "exhumed", "deep", "bad\u0002.img"), Buffer.alloc(5));
    symlinkSync(path.join(outside, "secret.img"), path.join(root, "exhumed", "s.img"));

    const store = createStore(path.join(base, "data"));
    const scanner = new Scanner({ client: new FakeClient(), store, root, timers: noTimers });
    scanner.triggerScan();
    await scanner.idle();

    const status = scanner.getStatus();
    expect(status.state).toBe("idle");
    expect(status.error).toBeNull();
    expect(status.total).toBe(validPaths.length);
    expect(status.scanned).toBe(validPaths.length);

    const missing = hostile.filter(
      ([rel, code]) =>
        !status.libraryWarnings.some((w) => w.path === displayName(rel) && w.code === code),
    );
    expect(missing).toEqual([]);

    const leaked = status.libraryWarnings.filter(
      (w) => (w.path ?? "").startsWith("exhumed") || JSON.stringify(w).includes(base),
    );
    expect(leaked).toEqual([]);

    const read = store.read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(Object.keys(read.value.cards)).toHaveLength(validPaths.length);
      expect(Object.keys(read.value.paths).sort()).toEqual([...validPaths].sort());
      const statuses = Object.values(read.value.cards).map((c) => c.status);
      expect(statuses.every((s) => s === "catalogued")).toBe(true);
    }

    // A path whose directory component is a symlink out of the library is refused.
    symlinkSync(outside, path.join(root, "hop"));
    const hop = await hashCandidate(root, { relPath: "hop/secret.img", size: 512, mtimeMs: 0 });
    expect(hop.ok).toBe(false);
    if (!hop.ok) expect(hop.warning.code).toBe("OUTSIDE_LIBRARY");

    // A symlinked image is refused by the O_NOFOLLOW open.
    const link = await hashCandidate(root, { relPath: "link-outside.img", size: 512, mtimeMs: 0 });
    expect(link.ok).toBe(false);
  });
});
