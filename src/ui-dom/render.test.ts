// @vitest-environment happy-dom
import fc from "fast-check";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, it } from "vitest";
import type { DiskCardView, FileEntry } from "../shared/schema";
import type { DiskDetail, ExhumeApi, PreviewResponse } from "../../ui/src/lib/api";
import { LibraryView } from "../../ui/src/LibraryView";
import { DiskView } from "../../ui/src/DiskView";

// Feature: crew-app, Property 32: Untrusted text renders literally
// **Validates: Requirements 13.2, 15.1, 15.9, 16.6, 19.11**

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: mock every collapsed clamped paragraph as clipped so the toggles render.
const clientHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const scrollHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains("ec-clamp") ? 40 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains("ec-clamp") && this.getAttribute("data-clamped") === "true" ? 120 : 0;
  },
});
afterAll(() => {
  if (clientHeightDesc) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDesc);
  if (scrollHeightDesc) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDesc);
});
const DISK_ID = "a".repeat(64);
const NEUTRAL = "x";

const FRAGMENTS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">link</a>',
  "<iframe src=//evil></iframe>",
  "<svg onload=alert(1)>",
  "<style>*{display:none}</style>",
  "<b>bold</b>",
  '" onmouseover="alert(1)',
  "&lt;b&gt;&amp;",
  "</li></ul></div><h1>",
  "**x** # y `z`",
  "\u0000\u202e",
];

const hostile = fc
  .array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ unit: "binary", maxLength: 20 })), {
    minLength: 1,
    maxLength: 4,
  })
  .map((parts) => "<" + parts.join(""));

const FORBIDDEN_TAGS = new Set([
  "script", "img", "a", "iframe", "style", "object", "embed", "link", "meta", "b", "i", "u", "video", "audio",
]);

interface Texts {
  label: string;
  summary: string;
  notes: string[];
  path: string;
  reason: string;
  preview: string;
}

const texts = fc.record({
  label: hostile,
  summary: hostile,
  notes: fc.array(hostile, { maxLength: 3 }),
  path: hostile,
  reason: hostile,
  preview: hostile,
});

const neutral: Texts = { label: NEUTRAL, summary: NEUTRAL, notes: [NEUTRAL, NEUTRAL], path: NEUTRAL, reason: NEUTRAL, preview: NEUTRAL };

function makeCard(t: Texts): DiskCardView {
  return {
    diskId: DISK_ID,
    relPath: "disk.img",
    label: t.label,
    sizeBytes: 1474560,
    geometry: { source: "bpb", label: null },
    fileCount: 1,
    totalEntries: 2,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: [],
    counts: { alive: 1, recovered: 1, partial: 0, lost: 0 },
    warnings: [],
    status: "summarised",
    firstSeen: "2024-01-01T00:00:00.000Z",
    summary: { text: t.summary, savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-archivist" },
    notes: t.notes.map((text, i) => ({ id: `n${i}`, text, savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-undertaker" as const })),
  };
}

function makeFiles(t: Texts): FileEntry[] {
  return [
    { id: 1, path: t.path, kind: "file", state: "alive", size: 10, date: null },
    { id: 2, path: t.path, kind: "file", state: "recovered", size: 10, date: null, reason: t.reason },
  ];
}

function makeApi(t: Texts, preview: PreviewResponse): ExhumeApi {
  const card = makeCard(t);
  const detail: DiskDetail = { card, files: makeFiles(t), truncated: false, totalEntries: 2 };
  const never = (): Promise<never> => Promise.reject(new Error("unused"));
  return {
    getLibrary: () => Promise.resolve({ path: "/lib", error: null }),
    setLibrary: never,
    copyDemoLibrary: never,
    getScan: () => Promise.resolve({ state: "idle" } as never),
    startScan: never,
    listDisks: () => Promise.resolve({ disks: [card] }),
    getDisk: () => Promise.resolve(detail),
    getPreview: () => Promise.resolve(preview),
    exhumeAll: never,
    downloadCsv: never,
    downloadMarkdown: never,
  };
}

/** Tag names and attribute names (never values), depth first. */
function signature(node: Element): string {
  const attrs = node.getAttributeNames().sort().join(",");
  return `<${node.tagName.toLowerCase()} ${attrs}>${Array.from(node.children).map(signature).join("")}</>`;
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

// Fixed decoration (the header lantern) is the only SVG allowed: it must be aria-hidden, carry the
// lantern marker and use only these drawing tags. Text-built svg would add elements or change the count.
const LANTERN_TAGS = new Set(["svg", "defs", "radialgradient", "stop", "g", "rect", "circle", "path"]);

function svgCount(root: Element): number {
  return allElements(root).filter((el) => el.tagName.toLowerCase() === "svg").length;
}

function svgIsDecorOnly(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!LANTERN_TAGS.has(tag)) return false;
  if (tag !== "svg") return true;
  return el.getAttribute("aria-hidden") === "true" && el.getAttribute("data-testid") === "lantern";
}

function hasNoInjectedMarkup(root: Element): boolean {
  return allElements(root).every(
    (el) =>
      !FORBIDDEN_TAGS.has(el.tagName.toLowerCase()) &&
      (el.closest("svg") === null || svgIsDecorOnly(el)) &&
      el.getAttributeNames().every((n) => !n.startsWith("on") && n !== "style" && n !== "href" && n !== "src"),
  );
}

async function renderLibrary(t: Texts): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const api = makeApi(t, { kind: "text", format: "text", text: "", truncated: false, warnings: [] });
  await act(async () => {
    root.render(createElement(LibraryView, { api, onOpenDisk: () => undefined, onSummarise: () => undefined }));
  });
  container.dataset["root"] = "1";
  roots.set(container, root);
  return container;
}

async function renderDisk(t: Texts, preview: PreviewResponse): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const api = makeApi(t, preview);
  await act(async () => {
    root.render(createElement(DiskView, { api, diskId: DISK_ID, onBack: () => undefined, onAskUndertaker: () => undefined }));
  });
  const button = container.querySelector('button[aria-pressed]');
  if (button !== null) {
    await act(async () => {
      (button as HTMLElement).click();
    });
  }
  roots.set(container, root);
  return container;
}

const roots = new WeakMap<Element, ReturnType<typeof createRoot>>();

async function dispose(container: HTMLElement): Promise<void> {
  const root = roots.get(container);
  await act(async () => {
    root?.unmount();
  });
  container.remove();
}

const previewOf = (format: "markdown" | "csv" | "text", text: string, warning: string): PreviewResponse => ({
  kind: "text",
  format,
  text,
  truncated: false,
  warnings: [{ code: "w", message: warning }],
});

const PREVIEW_TAGS = new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "em", "strong", "code", "pre", "table", "tbody", "tr", "td", "section"]);

describe("Feature: crew-app, Property 32: Untrusted text renders literally", () => {
  it("Library view shows card text literally and builds no elements from it", async () => {
    const baseline = await renderLibrary(neutral);
    const baseSig = signature(baseline);
    const baseSvgs = svgCount(baseline);
    await dispose(baseline);
    const ok = await fc.assert(
      fc.asyncProperty(texts, async (t) => {
        const c = await renderLibrary({ ...t, notes: t.notes.length === 0 ? [NEUTRAL, NEUTRAL] : t.notes });
        try {
          const notes = t.notes.length === 0 ? [NEUTRAL, NEUTRAL] : t.notes;
          const card = c.querySelector('[data-testid="disk-card"]');
          if (card === null) return false;
          const text = c.textContent ?? "";
          const noteItems = Array.from(c.querySelectorAll('[data-testid="card-notes"] > li')).map(
            // Long notes also carry a fixed expand button; the note text is the paragraph.
            (li) => li.querySelector("p")?.textContent,
          );
          const sameShape = signature(c).length > 0 && (notes.length !== 2 || signature(c) === baseSig);
          return (
            hasNoInjectedMarkup(c) &&
            svgCount(c) === baseSvgs &&
            sameShape &&
            (card.querySelector("h3")?.textContent ?? "") === t.label &&
            card.querySelector("button[aria-label]")?.textContent === "Open disk" &&
            c.querySelector('[data-testid="card-summary"]')?.textContent === t.summary &&
            noteItems.length === notes.length &&
            noteItems.every((n, i) => n === notes[i]) &&
            text.includes(t.label) &&
            c.querySelector('[data-testid="card-status"]')?.textContent === "summarised" &&
            c.querySelector('[data-testid="card-counts"]')?.textContent === "Recovered 1Partial 0Lost 0" &&
            c.querySelector('[data-testid="card-warnings"]')?.textContent === "Warnings: 0"
          );
        } finally {
          await dispose(c);
        }
      }),
      { numRuns: 100 },
    );
    void ok;
  });

  it("Disk view and text previews show file names, reasons and preview text literally", async () => {
    const base = await renderDisk(neutral, previewOf("text", NEUTRAL, NEUTRAL));
    const baseSig = signature(base);
    const baseSvgs = svgCount(base);
    await dispose(base);
    await fc.assert(
      fc.asyncProperty(texts, async (t) => {
        // The header now shows notes, so keep their count (and clamp state) equal to the baseline.
        const c = await renderDisk({ ...t, notes: [NEUTRAL, NEUTRAL] }, previewOf("text", t.preview, t.summary));
        try {
          const pre = c.querySelector('[data-testid="preview-text"]');
          const graves = Array.from(c.querySelectorAll('[data-testid="tombstone"], [data-testid="open-grave"]'));
          return (
            hasNoInjectedMarkup(c) &&
            svgCount(c) === baseSvgs &&
            signature(c) === baseSig &&
            pre !== null &&
            pre.textContent === t.preview &&
            c.querySelector("h1")?.textContent === t.label &&
            c.querySelector('[data-testid="disk-summary"]')?.textContent === t.summary &&
            graves.length === 2 &&
            graves.every((g) => (g.textContent ?? "").includes(t.path)) &&
            (c.querySelector('[data-testid="grave-grade"]')?.textContent ?? "").includes(t.reason)
          );
        } finally {
          await dispose(c);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Markdown and CSV previews create only fixed element types without attributes", async () => {
    await fc.assert(
      fc.asyncProperty(texts, fc.constantFrom("markdown", "csv"), async (t, format) => {
        const c = await renderDisk(t, previewOf(format, t.preview, t.summary));
        try {
          const body = c.querySelector(`[data-testid="preview-${format}"]`);
          if (body === null) return false;
          const inner = allElements(body);
          return (
            hasNoInjectedMarkup(c) &&
            inner.every((el) => PREVIEW_TAGS.has(el.tagName.toLowerCase())) &&
            inner.every((el) => el.getAttributeNames().every((n) => n === "data-testid" || n === "class"))
          );
        } finally {
          await dispose(c);
        }
      }),
      { numRuns: 100 },
    );
  });
});
