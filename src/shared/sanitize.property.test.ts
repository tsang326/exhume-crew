import { describe, it } from "vitest";
import fc from "fast-check";
import { sanitizeAgentText, sanitizeFileName, FALLBACK_FILE_NAME } from "./sanitize";

const REMOVED = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/u;

// Any UTF-16 code unit (lone surrogates included), biased toward the removed set.
const unit = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }),
  fc.integer({ min: 0, max: 0x9f }),
  fc.constantFrom(0x200b, 0x200c, 0x200d, 0x2060, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff, 0xd800, 0xdc00, 0x41),
);
const unitString = fc
  .array(unit, { maxLength: 40 })
  .map((a) => a.map((c) => String.fromCharCode(c)).join(""));
const anyText = fc.oneof(unitString, fc.string({ unit: "binary", maxLength: 40 }), fc.string({ maxLength: 40 }));

/** True when the string has no lone surrogate. */
function wellFormed(s: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** Independent oracle: replace lone surrogates, then drop removed code points in order. */
function expected(s: string): string {
  const fixed = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  return Array.from(fixed)
    .filter((ch) => !REMOVED.test(ch))
    .join("");
}

describe("Feature: crew-app, Property 25: Agent text sanitising", () => {
  it("is well-formed and free of removed code points", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const out = sanitizeAgentText(s);
        return wellFormed(out) && !REMOVED.test(out);
      }),
      { numRuns: 200 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const once = sanitizeAgentText(s);
        return sanitizeAgentText(once) === once;
      }),
      { numRuns: 200 },
    );
  });

  it("keeps every other code point in order", () => {
    fc.assert(
      fc.property(anyText, (s) => sanitizeAgentText(s) === expected(s)),
      { numRuns: 200 },
    );
  });
});

describe("Feature: crew-app, Property 31: Download file name sanitising", () => {
  // **Validates: Requirements 15.7, 15.8**
  const nameInput = fc.oneof(
    anyText,
    fc.string({ maxLength: 400 }),
    fc.string({ unit: "binary", maxLength: 400 }),
    fc.constantFrom("", ".", "..", "/", "\\", "../../etc/passwd", "a/b\\c", "<script>.csv"),
    fc.string({ minLength: 256, maxLength: 600 }),
  );

  it("returns a non-empty, safe name of at most 255 characters", () => {
    fc.assert(
      fc.property(nameInput, (s) => {
        const out = sanitizeFileName(s);
        return (
          out.length >= 1 &&
          out.length <= 255 &&
          /^[A-Za-z0-9._-]+$/.test(out) &&
          !out.includes("/") &&
          !out.includes("\\")
        );
      }),
      { numRuns: 200 },
    );
  });

  it("returns the fixed fallback when nothing usable remains", () => {
    fc.assert(
      fc.property(fc.constantFrom("", ".", "..", "...."), (s) => sanitizeFileName(s) === FALLBACK_FILE_NAME),
      { numRuns: 100 },
    );
  });
});
