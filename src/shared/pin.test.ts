import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkPinnedFile, parsePinRecord } from "./pin";

const root = resolve(__dirname, "../..");
const hex = (len: number) =>
  fc.array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: len, maxLength: len }).map((a) => a.join(""));

describe("pinned Exhume bundle", () => {
  it("mcp/PINNED.md is a valid record and matches mcp/exhume-mcp.mjs", () => {
    const text = readFileSync(resolve(root, "mcp/PINNED.md"), "utf8");
    const parsed = parsePinRecord(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const bytes = readFileSync(resolve(root, "mcp/exhume-mcp.mjs"));
    const result = checkPinnedFile(bytes, parsed.record);
    if (!result.ok) throw new Error(result.error);
    expect(result.actual).toBe(parsed.record.sha256);
  });
});

describe("parsePinRecord", () => {
  it("accepts a well-formed record", () => {
    const sha = "a".repeat(64);
    const commit = "b".repeat(40);
    const r = parsePinRecord(`at commit \`${commit}\`\n\nSHA-256: \`${sha}\`\n`);
    expect(r).toEqual({ ok: true, record: { sha256: sha, commit } });
  });

  it("rejects missing, short, upper-case or non-hex SHA-256", () => {
    const commit = "b".repeat(40);
    for (const bad of ["", "abc", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      expect(parsePinRecord(`commit ${commit}\nSHA-256: \`${bad}\``).ok).toBe(false);
    }
    expect(parsePinRecord(`commit ${commit}`).ok).toBe(false);
  });

  it("rejects a missing or malformed commit hash", () => {
    const sha = "a".repeat(64);
    expect(parsePinRecord(`SHA-256: \`${sha}\``).ok).toBe(false);
    expect(parsePinRecord(`commit abc1234\nSHA-256: \`${sha}\``).ok).toBe(false);
  });

  it("round-trips any valid hashes and rejects any wrong-length hash", () => {
    fc.assert(
      fc.property(hex(64), hex(40), (sha, commit) => {
        const r = parsePinRecord(`commit \`${commit}\`\nSHA-256: \`${sha}\`\n`);
        return r.ok && r.record.sha256 === sha && r.record.commit === commit;
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }).filter((n) => n !== 64).chain((n) => hex(n)),
        hex(40),
        (sha, commit) => !parsePinRecord(`commit ${commit}\nSHA-256: \`${sha}\``).ok,
      ),
      { numRuns: 100 },
    );
  });
});

describe("checkPinnedFile", () => {
  it("names expected and actual hash on mismatch", () => {
    const record = { sha256: "0".repeat(64), commit: "b".repeat(40) };
    const r = checkPinnedFile(new Uint8Array([1, 2, 3]), record);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(record.sha256);
      expect(r.error).toContain(r.actual);
    }
  });

  it("passes for any bytes hashed against their own digest and fails once a byte changes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 256 }), (bytes) => {
        const first = checkPinnedFile(bytes, { sha256: "0".repeat(64), commit: "b".repeat(40) });
        const record = { sha256: first.actual, commit: "b".repeat(40) };
        const mutated = Uint8Array.from(bytes);
        mutated[0] = (mutated[0] ?? 0) ^ 1;
        return checkPinnedFile(bytes, record).ok && !checkPinnedFile(mutated, record).ok;
      }),
      { numRuns: 100 },
    );
  });
});
