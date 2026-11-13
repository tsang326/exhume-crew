import { afterAll, beforeAll, describe, it } from "vitest";
import fc from "fast-check";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "./errors";
import { LibraryManager, validateLibraryPath } from "./library";

const NUM_RUNS = 100;
const seg = fc.stringMatching(/^[a-z0-9]{1,6}$/);
const homeSegs = fc.array(seg, { minLength: 1, maxLength: 3 });
const subSegs = fc.array(seg, { minLength: 1, maxLength: 3 });

type Kind =
  | "home"
  | "ancestor"
  | "root"
  | "descendant"
  | "descendantTilde"
  | "sibling"
  | "prefixSibling"
  | "missing"
  | "file";

const kind = fc.constantFrom<Kind>(
  "home",
  "ancestor",
  "root",
  "descendant",
  "descendantTilde",
  "sibling",
  "prefixSibling",
  "missing",
  "file",
);

let base = "";
let counter = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "crew-lib-prop-")));
});

afterAll(async () => {
  if (base !== "") await rm(base, { recursive: true, force: true });
});

interface Scenario {
  readonly home: string;
  readonly candidate: string;
  /** Expected outcome: an error code, or "ok" with the expected real path. */
  readonly expected: string;
}

/** Builds a fresh fake home and a candidate of the given kind inside the temp base. */
async function build(k: Kind, hs: string[], ss: string[], ancestorDepth: number): Promise<Scenario> {
  const run = path.join(base, `r${counter++}`);
  const home = path.join(run, "home", ...hs);
  await mkdir(home, { recursive: true });
  const last = hs[hs.length - 1] as string;
  const parent = path.dirname(home);
  switch (k) {
    case "home":
      return { home, candidate: home, expected: "LIBRARY_TOO_BROAD" };
    case "root":
      return { home, candidate: path.parse(home).root, expected: "LIBRARY_TOO_BROAD" };
    case "ancestor": {
      let anc = home;
      const steps = 1 + (ancestorDepth % (hs.length + 2));
      for (let i = 0; i < steps; i++) anc = path.dirname(anc);
      return { home, candidate: anc, expected: "LIBRARY_TOO_BROAD" };
    }
    case "descendant": {
      const d = path.join(home, ...ss);
      await mkdir(d, { recursive: true });
      return { home, candidate: d, expected: "ok:" + d };
    }
    case "descendantTilde": {
      const d = path.join(home, ...ss);
      await mkdir(d, { recursive: true });
      return { home, candidate: "~/" + ss.join("/"), expected: "ok:" + d };
    }
    case "sibling": {
      const d = path.join(parent, last + "-other");
      await mkdir(d, { recursive: true });
      return { home, candidate: d, expected: "ok:" + d };
    }
    case "prefixSibling": {
      // Shares a string prefix with the home path but is not under it by segment.
      const d = home + "x";
      await mkdir(d, { recursive: true });
      return { home, candidate: d, expected: "ok:" + d };
    }
    case "missing":
      return { home, candidate: path.join(home, ...ss, "missing"), expected: "LIBRARY_NOT_FOUND" };
    case "file": {
      const f = path.join(home, "afile");
      await writeFile(f, "x");
      return { home, candidate: f, expected: "LIBRARY_NOT_DIRECTORY" };
    }
  }
}

async function outcome(candidate: string, home: string): Promise<{ result: string; message: string }> {
  try {
    const real = await validateLibraryPath(candidate, home);
    return { result: "ok:" + real, message: "" };
  } catch (err) {
    if (err instanceof ApiError) return { result: err.code, message: err.message };
    return { result: "other", message: "" };
  }
}

describe("Feature: crew-app, Property 7: Library path classification", () => {
  it("classifies candidates against a fake home and never leaks a path", async () => {
    await fc.assert(
      fc.asyncProperty(kind, homeSegs, subSegs, fc.nat(10), async (k, hs, ss, depth) => {
        const s = await build(k, hs, ss, depth);
        const { result, message } = await outcome(s.candidate, s.home);
        const noPath = !message.includes(base) && !message.includes("/");
        return result === s.expected && noPath;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a rejected submission keeps the previous path and starts nothing", async () => {
    await fc.assert(
      fc.asyncProperty(kind, homeSegs, subSegs, fc.nat(10), async (k, hs, ss, depth) => {
        const s = await build(k, hs, ss, depth);
        const good = path.join(s.home, "good");
        await mkdir(good, { recursive: true });
        const dataDir = path.join(path.dirname(path.dirname(s.home)), "data");
        let restarts = 0;
        let scans = 0;
        const mgr = new LibraryManager({
          dataDir,
          home: s.home,
          restartExhume: () => {
            restarts++;
          },
          triggerScan: () => {
            scans++;
          },
        });
        await mgr.setLibrary(good);
        const before = { restarts, scans, real: mgr.getRealPath(), typed: mgr.getStatus().path };
        const files = await readdir(dataDir);
        let rejected = false;
        try {
          await mgr.setLibrary(s.candidate);
        } catch {
          rejected = true;
        }
        const shouldReject = !s.expected.startsWith("ok:");
        if (!shouldReject) return !rejected;
        const filesAfter = await readdir(dataDir);
        return (
          rejected &&
          restarts === before.restarts &&
          scans === before.scans &&
          mgr.getRealPath() === before.real &&
          mgr.getStatus().path === before.typed &&
          filesAfter.join(",") === files.join(",")
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
