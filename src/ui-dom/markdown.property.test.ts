import fc from "fast-check";
import { describe, it } from "vitest";
import { parseMarkdown, type MdBlock, type MdInline } from "../../ui/src/lib/markdown";

// Feature: crew-app, Property 33: Markdown preview builds no HTML
// **Validates: Requirements 14.3, 15.9**

const BLOCK_KEYS: Record<string, readonly string[]> = {
  heading: ["type", "level", "children"],
  paragraph: ["type", "children"],
  list: ["type", "ordered", "items"],
  "list-item": ["type", "children"],
  emphasis: ["type", "children"],
  strong: ["type", "children"],
  code: ["type", "text"],
  text: ["type", "text"],
};

/** Walks the tree; returns concatenated text and whether every node is allowed. */
function walk(node: MdBlock | MdInline | { type: "list-item"; children: readonly MdInline[] }): {
  ok: boolean;
  text: string;
} {
  const n = node as unknown as Record<string, unknown>;
  const type = n["type"];
  if (typeof type !== "string" || !(type in BLOCK_KEYS)) return { ok: false, text: "" };
  const keys = Object.keys(n).sort().join(",");
  let ok = keys === [...(BLOCK_KEYS[type] ?? [])].sort().join(",");
  if (type === "heading") ok = ok && [1, 2, 3, 4, 5, 6].includes(n["level"] as number);
  if (type === "list") ok = ok && typeof n["ordered"] === "boolean";
  let text = "";
  if (type === "text" || type === "code") {
    ok = ok && typeof n["text"] === "string";
    text = String(n["text"]);
  }
  const kids = (n["children"] ?? n["items"]) as readonly never[] | undefined;
  if (kids !== undefined) {
    ok = ok && Array.isArray(kids);
    for (const k of kids) {
      const r = walk(k);
      ok = ok && r.ok;
      text += r.text;
    }
  }
  return { ok, text };
}

function isSubsequence(small: string, big: string): boolean {
  let j = 0;
  for (let i = 0; i < big.length && j < small.length; i++) {
    if (big[i] === small[j]) j++;
  }
  return j === small.length;
}

const hostileFragment = fc.constantFrom(
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "[x](javascript:alert(1))",
  "![i](http://e/x.png)",
  "<a href=\"x\">y</a>",
  "**", "*", "__", "_", "`", "```", "~~~", "# ", "###### ", "####### ",
  "- ", "1. ", "+ ", "\n", "\r\n", "\r", "\t", "\u0000", "\u2028",
);
const hostileSource = fc
  .array(fc.oneof(hostileFragment, fc.string({ maxLength: 12 }), fc.string({ unit: "binary", maxLength: 12 })), {
    maxLength: 40,
  })
  .map((parts) => parts.join(""));

describe("Feature: crew-app, Property 33: Markdown preview builds no HTML", () => {
  it("never throws and only yields allowed node types with no source-derived attributes", () => {
    fc.assert(
      fc.property(fc.oneof(hostileSource, fc.string({ unit: "binary", maxLength: 200 })), (src) => {
        const blocks = parseMarkdown(src);
        return Array.isArray(blocks) && blocks.every((b) => walk(b).ok);
      }),
      { numRuns: 200 },
    );
  });

  it("never throws on deeply nested or very long markers", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("*", "_", "**", "`", "#", "-", "1."),
        fc.integer({ min: 0, max: 3000 }),
        (marker, count) => {
          const blocks = parseMarkdown(marker.repeat(count) + "a" + marker.repeat(count));
          return blocks.every((b) => walk(b).ok);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("concatenated text is the source minus consumed markers (subsequence of the source)", () => {
    fc.assert(
      fc.property(hostileSource, (src) => {
        const normalised = src.replace(/\r\n|\r/g, "\n");
        const text = parseMarkdown(src)
          .map((b) => walk(b).text)
          .join("");
        return isSubsequence(text, normalised);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps every letter when the source has no code fences or code spans", () => {
    const letters = fc
      .array(fc.constantFrom("a", "b", "Z", "é", " ", "\n", "\n\n", "*", "_", "#", "- ", "<", ">", "[", "]", "(", ")", "!"), {
        maxLength: 60,
      })
      .map((p) => p.join(""));
    fc.assert(
      fc.property(letters, (src) => {
        const text = parseMarkdown(src)
          .map((b) => walk(b).text)
          .join("");
        const keep = (s: string): string => s.replace(/[^a-zZé]/g, "");
        return keep(text) === keep(src);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps raw HTML and link syntax as literal text", () => {
    fc.assert(
      fc.property(fc.constantFrom("<script>alert(1)</script>", "[x](http://e)", "![i](http://e/i.png)", "<img src=x onerror=1>"), (frag) => {
        const text = parseMarkdown(frag)
          .map((b) => walk(b).text)
          .join("");
        return text === frag;
      }),
      { numRuns: 100 },
    );
  });
});
