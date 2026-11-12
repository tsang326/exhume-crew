import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyDemoLibrary, DEMO_DIR_NAME, DEMO_FAILURE_POINTS, type DemoFailurePoint } from "./demo";

const NUM_RUNS = 100;
const DEMO_NAMES = ["a-disk.img", "b-disk.img", "c-disk.img"] as const;

let base = "";
let counter = 0;
/** Fake appRoot with its own demo-library (the real demo-library/ is never touched). */
let appRoot = "";
const demoBytes = new Map<string, Buffer>();

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "crew-demo-prop-")));
  appRoot = path.join(base, "app");
  await mkdir(path.join(appRoot, DEMO_DIR_NAME), { recursive: true });
  for (const [i, name] of DEMO_NAMES.entries()) {
    const bytes = Buffer.alloc(2048, i + 1);
    demoBytes.set(name, bytes);
    await writeFile(path.join(appRoot, DEMO_DIR_NAME, name), bytes);
  }
  await writeFile(path.join(appRoot, DEMO_DIR_NAME, "NOTICE.md"), "notice");
});

afterAll(async () => {
  if (base !== "") await rm(base, { recursive: true, force: true });
});

/** Pre-existing file: either a demo image name or an unrelated name, with arbitrary bytes. */
const preExisting = fc.record({
  demo: fc.subarray([...DEMO_NAMES]),
  other: fc.array(fc.stringMatching(/^[a-z0-9]{1,6}\.dat$/), { maxLength: 3 }),
  bytes: fc.uint8Array({ minLength: 1, maxLength: 64 }),
});

const scenario = fc.record({
  existing: preExisting,
  libraryExists: fc.boolean(),
  /** Which demo image (index) the failure hits. */
  failIndex: fc.integer({ min: 0, max: DEMO_NAMES.length - 1 }),
});

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** Runs one copy with a failure at `point` (or none) and checks every invariant. */
async function runOnce(
  s: {
    existing: { demo: string[]; other: string[]; bytes: Uint8Array };
    libraryExists: boolean;
    failIndex: number;
  },
  point: DemoFailurePoint | null,
): Promise<boolean> {
  const home = path.join(base, `h${counter++}`);
  const library = path.join(home, "lib");
  await mkdir(home, { recursive: true });
  const before = new Map<string, Buffer>();
  if (s.libraryExists) {
    await mkdir(library);
    const names = new Set<string>([...s.existing.demo, ...s.existing.other]);
    for (const n of names) {
      await writeFile(path.join(library, n), s.existing.bytes);
      before.set(n, Buffer.from(s.existing.bytes));
    }
  }
  const target = DEMO_NAMES[s.failIndex] as string;
  const inject =
    point === null
      ? undefined
      : (p: DemoFailurePoint, fileName: string): void => {
          if (p === point && (fileName === "" || fileName === target)) throw new Error("injected");
        };

  let threw = false;
  let result: { copied: readonly string[]; skipped: readonly string[] } | null = null;
  try {
    result = await copyDemoLibrary(appRoot, library, { userInitiated: true, home, inject });
  } catch {
    threw = true;
  }

  let ok = true;
  // A failure injected at a point that is reached must surface as an error.
  const reached = point !== "mkdir-library" || !s.libraryExists;
  if (point !== null && reached && !threw) ok = false;
  if (point === null && threw) ok = false;

  let after: string[] = [];
  try {
    after = await readdir(library);
  } catch {
    after = []; // library absent (mkdir failed)
  }
  // No temporary file remains.
  if (after.some((n) => n.startsWith(".demo-") || n.endsWith(".tmp"))) ok = false;
  // Pre-existing files keep their bytes.
  for (const [n, bytes] of before) {
    const now = await readFile(path.join(library, n)).catch(() => null);
    if (now === null || !sameBytes(now, bytes)) ok = false;
  }
  // Every non-pre-existing demo image is fully present or absent.
  for (const name of DEMO_NAMES) {
    if (before.has(name)) continue;
    const now = await readFile(path.join(library, name)).catch(() => null);
    if (now !== null && !sameBytes(now, demoBytes.get(name) as Buffer)) ok = false;
    if (point === null && now === null) ok = false;
  }
  // Nothing outside the pre-existing files and demo images appears.
  const allowed = new Set<string>([...before.keys(), ...DEMO_NAMES]);
  if (after.some((n) => !allowed.has(n))) ok = false;
  // A successful result never lists a pre-existing name as copied.
  if (result !== null && result.copied.some((n) => before.has(n))) ok = false;
  // The source demo images are untouched.
  for (const [name, bytes] of demoBytes) {
    const now = await readFile(path.join(appRoot, DEMO_DIR_NAME, name)).catch(() => null);
    if (now === null || !sameBytes(now, bytes)) ok = false;
  }
  return ok;
}

describe("Feature: crew-app, Property 8: Demo copy never overwrites and leaves no partial file", () => {
  it("holds for every failure point and any pre-existing Library content", async () => {
    // **Validates: Requirements 3.2, 3.3, 7.13**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        let all = await runOnce(s, null);
        for (const point of DEMO_FAILURE_POINTS) {
          if (!(await runOnce(s, point))) all = false;
        }
        return all;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(DEMO_FAILURE_POINTS.length).toBe(4);
  });
});
