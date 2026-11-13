import { describe, it } from "vitest";
import fc from "fast-check";
import { guardParams, parseDiskId, parseEntryId } from "./params";

const NUM_RUNS = 200;
const hexChar = fc.constantFrom(..."0123456789abcdef".split(""));
const diskId = fc.array(hexChar, { minLength: 64, maxLength: 64 }).map((a) => a.join(""));
const entryId = fc.integer({ min: 0, max: 4095 });
const safeText = fc.stringMatching(/^[a-z0-9_-]{0,12}$/);

const enc = (s: string): string =>
  Array.from(s)
    .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");

const control = fc.integer({ min: 0, max: 0x1f }).map((n) => String.fromCharCode(n));
const del = fc.constantFrom("\u007f", "\u0080", "\u009f");

/** A hostile value in raw (undecoded) URL form, in either a path or query slot. */
const hostileRaw = fc.oneof(
  // dot-dot, literal and encoded, single and double encoded
  fc.tuple(safeText, fc.constantFrom("..", "%2e%2e", "%2E%2E", ".%2e", "%2e.", "%252e%252e", "%252E."), safeText).map((t) => t.join("")),
  // leading backslash, literal or encoded
  fc.tuple(fc.constantFrom("\\", "%5c", "%5C"), safeText).map((t) => t.join("")),
  // leading slash (encoded, since a literal one splits segments)
  fc.tuple(fc.constantFrom("%2f", "%2F"), safeText).map((t) => t.join("")),
  // NUL and control characters, encoded
  fc.tuple(safeText, fc.oneof(control, del), safeText).map(([a, c, b]) => a + enc(c) + b),
  // double-encoded anything: a % remaining after one decode
  fc.tuple(safeText, safeText).map(([a, b]) => a + "%25" + enc("x") + b),
  // malformed escapes
  fc.tuple(safeText, fc.constantFrom("%", "%zz", "%4", "%e0%a4%a")).map((t) => t.join("")),
);

// Embedded separators are hostile only inside a path segment.
const embeddedSeparator = fc
  .tuple(safeText, fc.constantFrom("%2f", "%5c", "%2F", "%5C"), safeText)
  .map((t) => t.join(""));

describe("Feature: crew-app, Property 16: Parameter guard", () => {
  it("rejects encoded separators inside a path segment with 400", () => {
    fc.assert(
      fc.property(diskId, embeddedSeparator, (id, bad) => {
        const r = guardParams(`/api/disks/${id}/${bad}`, []);
        return !r.ok && r.error.status === 400;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects hostile path segments with 400", () => {
    fc.assert(
      fc.property(diskId, hostileRaw, (id, bad) => {
        const r = guardParams(`/api/disks/${id}/${bad}`, []);
        return !r.ok && r.error.status === 400;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects hostile query values and names with 400", () => {
    fc.assert(
      fc.property(hostileRaw, fc.boolean(), (bad, inName) => {
        const url = inName ? `/api/disks?${bad}=1` : `/api/disks?entry=${bad}`;
        const r = guardParams(url, ["entry"]);
        return !r.ok && r.error.status === 400;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects raw control characters anywhere in the target", () => {
    fc.assert(
      fc.property(safeText, control, safeText, (a, c, b) => {
        const r = guardParams(`/api/${a}${c}${b}`, []);
        return !r.ok && r.error.status === 400;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects values outside the typed grammar", () => {
    const badDisk = fc.oneof(
      fc.array(hexChar, { minLength: 0, maxLength: 63 }).map((a) => a.join("")),
      fc.array(hexChar, { minLength: 65, maxLength: 80 }).map((a) => a.join("")),
      diskId.map((s) => s.toUpperCase().replace(/[0-9]/g, "A")),
      diskId.map((s) => "g" + s.slice(1)),
    );
    const badEntry = fc.oneof(
      fc.integer({ min: 4096, max: 1_000_000 }).map(String),
      fc.integer({ min: -1_000_000, max: -1 }).map(String),
      entryId.map((n) => String(n).padStart(5, "0")),
      entryId.map((n) => `${n}.5`),
      fc.constantFrom("", "abc", "1e3", "0x10", " 7", "7 "),
    );
    fc.assert(
      fc.property(badDisk, badEntry, (d, e) => parseDiskId(d) === null && parseEntryId(e) === null),
      { numRuns: NUM_RUNS },
    );
  });

  it("passes well-formed Disk_Id and entry values unchanged", () => {
    fc.assert(
      fc.property(diskId, entryId, (id, n) => {
        const r = guardParams(`/api/disks/${id}/preview/${n}?entry=${n}`, ["entry"]);
        return (
          r.ok &&
          r.params.segments[2] === id &&
          r.params.segments[4] === String(n) &&
          r.params.query["entry"] === String(n) &&
          parseDiskId(id) === id &&
          parseEntryId(String(n)) === n &&
          parseEntryId(n) === n
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
