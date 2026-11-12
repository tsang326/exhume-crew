import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import fc from "fast-check";
import { checkPinnedFile, parsePinRecord } from "./pin";

const HEX = "0123456789abcdef".split("");
const hex = (min: number, max: number = min) =>
  fc.array(fc.constantFrom(...HEX), { minLength: min, maxLength: max }).map((a) => a.join(""));

// Prose lines that contain neither "SHA-256:" at a line start nor the word "commit".
const noise = fc
  .array(fc.constantFrom("# Pinned bundle", "Source: upstream repo", "", "Do not edit.", "License: MIT"), {
    maxLength: 4,
  })
  .map((lines) => lines.join("\n"));

const record = (sha: string, commit: string, pre: string, post: string): string =>
  `${pre}\nPinned at commit \`${commit}\`\n\nSHA-256: \`${sha}\`\n${post}\n`;

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("Feature: crew-app, Property 5: Pin record parsing", () => {
  it("returns the hashes for every well-formed record", () => {
    fc.assert(
      fc.property(hex(64), hex(40), noise, noise, (sha, commit, pre, post) => {
        const r = parsePinRecord(record(sha, commit, pre, post));
        return r.ok && r.record.sha256 === sha && r.record.commit === commit;
      }),
      { numRuns: 200 },
    );
  });

  it("returns an invalid-record error when the SHA-256 value is not 64 lower-case hex characters", () => {
    const badSha = fc.oneof(
      fc.integer({ min: 0, max: 100 }).filter((n) => n !== 64).chain((n) => hex(n)),
      hex(64).map((s) => s.slice(0, 63) + "G"),
      hex(64).map((s) => s.slice(0, 10) + "A" + s.slice(11)),
    );
    fc.assert(
      fc.property(badSha, hex(40), noise, (sha, commit, pre) => !parsePinRecord(record(sha, commit, pre, "")).ok),
      { numRuns: 200 },
    );
  });

  it("returns an invalid-record error when the commit is not exactly 40 lower-case hex characters", () => {
    const badCommit = fc.oneof(
      fc.integer({ min: 7, max: 64 }).filter((n) => n !== 40).chain((n) => hex(n)),
      hex(40).map((s) => "A" + s.slice(1)),
    );
    fc.assert(
      fc.property(hex(64), badCommit, noise, (sha, commit, pre) => !parsePinRecord(record(sha, commit, pre, "")).ok),
      { numRuns: 200 },
    );
  });

  it("returns an invalid-record error when a line or commit is missing", () => {
    fc.assert(
      fc.property(hex(64), hex(40), noise, (sha, commit, pre) => {
        const noSha = `${pre}\nPinned at commit \`${commit}\`\n`;
        const noCommit = `${pre}\nSHA-256: \`${sha}\`\n`;
        return !parsePinRecord(noSha).ok && !parsePinRecord(noCommit).ok;
      }),
      { numRuns: 100 },
    );
  });

  it("for any text, success implies the text holds a 64-hex SHA-256 line and a 40-hex commit", () => {
    const text = fc.oneof(
      fc.string({ maxLength: 200 }),
      fc.tuple(fc.string({ maxLength: 40 }), hex(0, 70), hex(0, 50)).map(
        ([s, a, b]) => `${s}\ncommit ${b}\nSHA-256: ${a}\n`,
      ),
    );
    fc.assert(
      fc.property(text, (t) => {
        const r = parsePinRecord(t);
        if (!r.ok) return true;
        return (
          /^[0-9a-f]{64}$/.test(r.record.sha256) &&
          /^[0-9a-f]{40}$/.test(r.record.commit) &&
          t.includes(r.record.sha256) &&
          t.includes(r.record.commit)
        );
      }),
      { numRuns: 200 },
    );
  });

  it("fails the file check naming expected and actual hash for any differing content", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), fc.uint8Array({ maxLength: 128 }), hex(40), (a, b, commit) => {
        const expected = sha256Of(a);
        const r = checkPinnedFile(b, { sha256: expected, commit });
        if (expected === sha256Of(b)) return r.ok;
        return !r.ok && r.actual === sha256Of(b) && r.error.includes(expected) && r.error.includes(r.actual);
      }),
      { numRuns: 200 },
    );
  });
});
