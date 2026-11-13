import { describe, expect, it } from "vitest";
import { toMarkdown } from "./exports";
import type { DiskCardView } from "../../src/shared/schema";

const ID = "ab".repeat(32);

function card(over: Partial<DiskCardView> = {}): DiskCardView {
  return {
    diskId: ID,
    relPath: "boxes/a.img",
    label: "Harbor Note",
    sizeBytes: 737280,
    geometry: { source: "bpb", label: "720K" },
    fileCount: 3,
    totalEntries: 3,
    entriesTruncated: false,
    dateFirst: "1991-01-02",
    dateLast: "1992-03-04",
    formats: ["text"],
    counts: { alive: 1, recovered: 2, partial: 1, lost: 0 },
    warnings: [{ code: "W1", message: "FAT mismatch" }],
    status: "summarised",
    firstSeen: "2025-01-01T00:00:00Z",
    summary: { text: "Letters about the harbor.", savedAt: "2025-01-02T00:00:00Z", agent: "exhume-archivist" },
    notes: [{ id: "n1", text: "Check the second copy.", savedAt: "2025-01-03T00:00:00Z", agent: "exhume-undertaker" }],
    ...over,
  };
}

describe("toMarkdown finding aid", () => {
  it("renders a readable section per disk", () => {
    expect(toMarkdown([card()])).toBe(
      [
        "# Exhume Crew catalogue",
        "",
        "## Harbor Note (boxes/a.img)",
        "",
        "720.0 KiB · geometry 720K · 3 files · 1991-01-02 to 1992-03-04 · 2 recovered, 1 partial, 0 lost",
        "",
        "Warnings:",
        "- W1: FAT mismatch",
        "",
        "Letters about the harbor.",
        "",
        "Notes:",
        "- Check the second copy.",
        "",
        `<sub>\`${ID}\`</sub>`,
        "",
      ].join("\n"),
    );
  });

  it("falls back to relPath for an empty label and omits empty parts", () => {
    const out = toMarkdown([card({ label: "", warnings: [], summary: null, notes: [] })]);
    expect(out).toContain("\n## boxes/a.img\n");
    expect(out).not.toContain("Warnings:");
    expect(out).not.toContain("Notes:");
  });

  it("yields only the title for an empty catalogue", () => {
    expect(toMarkdown([])).toBe("# Exhume Crew catalogue\n");
  });

  it("keeps a hostile summary as inert single-line text", () => {
    const hostile = [
      "# Heading",
      "Setext",
      "======",
      "---",
      "[click](http://evil.test) ![i](http://evil.test/a.png) <script>alert(1)</script>",
      "`code` ```",
      "~~~",
      "| a | b |",
      "|---|---|",
      "> quote",
      "1. item",
      "    indented",
    ].join("\n");
    const out = toMarkdown([card({ summary: { text: hostile, savedAt: "x", agent: "exhume-archivist" }, notes: [], warnings: [] })]);
    const para = out.split("\n\n")[3] ?? "";
    expect(para.includes("\n")).toBe(false);
    // No block marker at the start, no unescaped inline structure characters.
    expect(para).not.toMatch(/^(\s|[#>+=~-]|\d+[.)](\s|$))/);
    expect(para.replace(/\\[!-/:-@[-`{-~]/g, "")).not.toMatch(/[\\`*_[\]<>|]/);
    expect(para).toContain("\\# Heading");
    expect(para).toContain("\\[click\\]");
    expect(para).toContain("\\<script\\>");
  });
});
