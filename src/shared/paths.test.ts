import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { OUTSIDE_WRITE_MESSAGE, guardedWriteFile, isWithin } from "./paths";

// Per case the fixture is exactly: 1 temporary directory (plus 3 fixed subdirectories)
// and 2 symlinks inside the base: link_in (to base/inner) and link_out (to outside).
const SEED_INSIDE = "inside-seed";
const SEED_OUTSIDE = "outside-seed";

const NAME_TOKENS = ["inner", "link_in", "link_out", "new", "..", ".."];
const ABS_TOKENS = ["@TMP/base", "@TMP/outside", "@TMP/base/link_out", "@TMP/base/inner", "@TMP/base/link_in/new", "@ROOT"];
const segmentArb = fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...NAME_TOKENS) }, { weight: 1, arbitrary: fc.constantFrom(...ABS_TOKENS) });
const segmentsArb = fc.array(segmentArb, { minLength: 0, maxLength: 6 });

function snapshot(root: string): string {
  const entries: string[] = [];
  const names = readdirSync(root, { recursive: true, withFileTypes: true });
  for (const d of names) {
    const p = join(d.parentPath, d.name);
    if (d.isFile()) entries.push(`F ${p} ${readFileSync(p, "utf8")}`);
    else if (d.isDirectory()) entries.push(`D ${p}`);
    else entries.push(`O ${p}`);
  }
  return entries.sort().join("\n");
}

/** Independent model: lexical resolution of the segments, then the two known symlinks. */
function modelInside(realTmp: string, segments: string[]): boolean {
  const tmpParts = realTmp.split(sep).filter((s) => s !== "");
  let parts: string[] = [...tmpParts, "base"];
  for (const raw of segments) {
    if (raw === "@ROOT") {
      parts = [];
    } else if (raw.startsWith("@TMP/")) {
      parts = [...tmpParts, ...raw.slice("@TMP/".length).split("/")];
    } else if (raw === "..") {
      parts.pop();
    } else {
      parts.push(raw);
    }
  }
  parts.push("leaf.txt");
  const rel = parts.slice(0, tmpParts.length).join("/") === tmpParts.join("/") ? parts.slice(tmpParts.length) : null;
  if (rel === null || rel[0] !== "base") return false;
  if (rel[1] === "link_out") return false;
  return true;
}

describe("Feature: crew-app, Property 21: Write-target guard", () => {
  it("isWithin matches the real-path model and rejected writes leave the target unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(segmentsArb, async (segments) => {
        const tmp = mkdtempSync(join(tmpdir(), "crew-guard-"));
        try {
          const realTmp = realpathSync(tmp);
          const base = join(realTmp, "base");
          const outside = join(realTmp, "outside");
          mkdirSync(join(base, "inner"), { recursive: true });
          mkdirSync(outside);
          symlinkSync(join(base, "inner"), join(base, "link_in"), "dir");
          symlinkSync(outside, join(base, "link_out"), "dir");
          writeFileSync(join(base, "inner", "leaf.txt"), SEED_INSIDE);
          writeFileSync(join(outside, "leaf.txt"), SEED_OUTSIDE);

          const concrete = segments.map((s) => s.replace("@TMP", realTmp).replace("@ROOT", sep));
          const target = resolve(base, ...concrete, "leaf.txt");
          const expected = modelInside(realTmp, segments);

          const within = await isWithin(base, target);
          const before = snapshot(realTmp);
          const result = await guardedWriteFile(base, target, "payload");
          const after = snapshot(realTmp);

          if (within !== expected) return false;
          if (expected) return result.ok && readFileSync(target, "utf8") === "payload";
          return (
            !result.ok &&
            result.error.message === OUTSIDE_WRITE_MESSAGE &&
            before === after &&
            readFileSync(join(outside, "leaf.txt"), "utf8") === SEED_OUTSIDE
          );
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
