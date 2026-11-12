import { describe, it } from "vitest";
import fc from "fast-check";
import { cellText } from "./sanitize";
import { csvRow } from "./csv";

const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const FORMULA_FIRST = new Set(["=", "+", "-", "@", "\t", "\r"]);

// Well-formed text biased toward control characters and formula starters.
const unit = fc.oneof(
  fc.integer({ min: 0, max: 0x9f }).map((c) => String.fromCharCode(c)),
  fc.constantFrom("=", "+", "-", "@", "\t", "\r", "\n", "'", ",", '"', "a", " "),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 2 }),
);
const text = fc.array(unit, { maxLength: 20 }).map((a) => a.join(""));

/** Independent oracle for the removal step. */
function strip(s: string): string {
  return Array.from(s)
    .filter((ch) => !FORBIDDEN.test(ch))
    .join("");
}

/** Reads one CSV field back (no embedded multi-field input is generated). */
function unquote(field: string): string {
  return field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field;
}

describe("Feature: crew-app, Property 23: CSV cell sanitising", () => {
  it("removes controls and adds exactly one quote only before formula starters", () => {
    fc.assert(
      fc.property(text, (s) => {
        const out = cellText(s);
        const cleaned = strip(s);
        const prefixed = cleaned.length > 0 && FORMULA_FIRST.has(cleaned.charAt(0));
        const want = prefixed ? `'${cleaned}` : cleaned;
        return !FORBIDDEN.test(out) && out === want;
      }),
      { numRuns: 200 },
    );
  });

  it("is applied to every cell of an exported CSV row", () => {
    fc.assert(
      fc.property(text, (s) => {
        const row = csvRow([s]);
        return unquote(row) === cellText(s);
      }),
      { numRuns: 200 },
    );
  });
});
