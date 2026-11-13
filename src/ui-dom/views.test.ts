// @vitest-environment happy-dom
/**
 * UI example tests for the Library and Disk views. No JSX: elements are built with createElement.
 * The API is an in-memory fake that implements the `ExhumeApi` interface.
 * Validates: Requirements 13.3, 13.4, 13.6, 13.8, 13.9, 13.10, 14.7, 14.9, 14.10, 14.11, 14.12, 15.5
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiskCardView, FileEntry, ScanStatus } from "../shared/schema";
import type { DiskDetail, ExhumeApi, ExhumeOutcome, PreviewResponse } from "../../ui/src/lib/api";
import { EXHUME_ALL_TOOLTIP, DiskView } from "../../ui/src/DiskView";
import { LibraryView } from "../../ui/src/LibraryView";
import { STYLE_TEXT } from "../../ui/src/styles";
import { SUMMARISE_PREFIX } from "../../ui/src/lib/messages";
import { conversionFor, formatBytes, formatDateRange } from "../../ui/src/lib/format";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);

function card(diskId: string, summarised: boolean): DiskCardView {
  return {
    diskId,
    relPath: `${diskId.slice(0, 4)}.img`,
    label: "LABEL",
    sizeBytes: 1440,
    geometry: { source: "bpb", label: null },
    fileCount: 1,
    totalEntries: 1,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: [],
    counts: { alive: 1, recovered: 0, partial: 0, lost: 0 },
    warnings: [],
    status: summarised ? "summarised" : "new",
    firstSeen: "2024-01-01T00:00:00.000Z",
    summary: summarised ? { text: "s", savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-archivist" } : null,
    notes: [],
  };
}

const idle: ScanStatus = {
  state: "idle",
  scanned: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  libraryWarnings: [],
};

function file(id: number, path: string, state: FileEntry["state"] = "alive"): FileEntry {
  return { id, path, kind: "file", state, size: 3, date: null };
}

function fakeApi(over: Partial<ExhumeApi> = {}): ExhumeApi {
  const unused = (): Promise<never> => Promise.reject(new Error("unused"));
  return {
    getLibrary: () => Promise.resolve({ path: "/lib", error: null }),
    setLibrary: unused,
    copyDemoLibrary: unused,
    getScan: () => Promise.resolve(idle),
    startScan: () => Promise.resolve({ started: true, running: true }),
    listDisks: () => Promise.resolve({ disks: [] }),
    getDisk: unused,
    getPreview: unused,
    exhumeAll: unused,
    downloadCsv: () => Promise.resolve(),
    downloadMarkdown: () => Promise.resolve(),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function mount(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
  await flush();
}

function q(sel: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(sel);
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find(
    (x) => x.textContent === text || x.getAttribute("aria-label") === text,
  );
  if (!b) throw new Error(`no button ${text}`);
  return b;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function library(api: ExhumeApi, onSummarise = vi.fn()): ReactElement {
  return createElement(LibraryView, { api, onOpenDisk: vi.fn(), onSummarise });
}

function detail(over: Partial<DiskDetail> = {}): DiskDetail {
  const files = [file(1, "A.TXT"), file(2, "GONE.TXT", "recovered")];
  return { card: card(ID_A, false), files, truncated: false, totalEntries: files.length, ...over };
}

function diskView(api: ExhumeApi, onAsk = vi.fn()): ReactElement {
  return createElement(DiskView, { api, diskId: ID_A, onBack: vi.fn(), onAskUndertaker: onAsk });
}

describe("Library view", () => {
  it("shows the empty state with a demo button and disabled export/summarise buttons", async () => {
    await mount(library(fakeApi()));
    expect(q('[data-testid="empty-state"]')).not.toBeNull();
    expect(button("Export CSV").disabled).toBe(true);
    expect(button("Export Markdown").disabled).toBe(true);
    expect(button("Summarise new disks").disabled).toBe(true);
    expect(button("Rescan").disabled).toBe(false);
    expect(container.querySelectorAll("button").length).toBeGreaterThan(4);
  });

  it("disables Rescan, exports and summarise while scanning and shows progress text", async () => {
    const running: ScanStatus = { ...idle, state: "running", scanned: 2, total: 5 };
    const api = fakeApi({
      getScan: () => Promise.resolve(running),
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
    });
    await mount(library(api));
    expect(q('[data-testid="scan-progress"]')?.textContent).toBe("Scanned 2 of 5 disks");
    for (const t of ["Rescan", "Export CSV", "Export Markdown", "Summarise new disks"]) {
      expect(button(t).disabled).toBe(true);
    }
  });

  it("shows a failed scan with Rescan enabled", async () => {
    const failed: ScanStatus = { ...idle, state: "failed", error: { code: "x", message: "boom" } };
    const api = fakeApi({
      getScan: () => Promise.resolve(failed),
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
    });
    await mount(library(api));
    expect(q('[data-testid="scan-error"]')).not.toBeNull();
    expect(button("Rescan").disabled).toBe(false);
  });

  it("enables export and summarise buttons when disks exist and no scan runs", async () => {
    const api = fakeApi({ listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }) });
    await mount(library(api));
    expect(button("Export CSV").disabled).toBe(false);
    expect(button("Summarise new disks").disabled).toBe(false);
  });

  it("opens an Archivist chat with the ids of disks lacking a Summary", async () => {
    const onSummarise = vi.fn();
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false), card(ID_B, true)] }),
    });
    await mount(library(api, onSummarise));
    await click(button("Summarise new disks"));
    expect(onSummarise).toHaveBeenCalledTimes(1);
    expect(onSummarise).toHaveBeenCalledWith(SUMMARISE_PREFIX + ID_A);
  });

  it("opens no chat when no disk lacks a Summary", async () => {
    const onSummarise = vi.fn();
    const api = fakeApi({ listDisks: () => Promise.resolve({ disks: [card(ID_B, true)] }) });
    await mount(library(api, onSummarise));
    await click(button("Summarise new disks"));
    expect(onSummarise).not.toHaveBeenCalled();
    expect(q('[data-testid="notice"]')?.textContent).toBe("There are no new disks to summarise.");
  });
});

describe("Library error", () => {
  it("clears a stale library error after the demo library is copied", async () => {
    let calls = 0;
    const api = fakeApi({
      getLibrary: () => {
        calls++;
        return Promise.resolve(
          calls === 1
            ? { path: "/gone", error: { code: "x", message: "That folder was not found." } }
            : { path: "/demo", error: null },
        );
      },
      copyDemoLibrary: () => Promise.resolve({} as never),
    });
    await mount(library(api));
    expect(q('[data-testid="library-error"]')?.textContent).toBe("That folder was not found.");
    await click(button("Use demo library"));
    expect(q('[data-testid="library-error"]')).toBeNull();
    expect(q('[data-testid="library-path"]')?.textContent).toBe("/demo");
  });

  it("clears the library error even if the later status cannot be read", async () => {
    let calls = 0;
    const api = fakeApi({
      getLibrary: () => {
        calls++;
        return calls === 1
          ? Promise.resolve({ path: "/gone", error: { code: "x", message: "That folder was not found." } })
          : Promise.reject(new Error("down"));
      },
      copyDemoLibrary: () => Promise.resolve({} as never),
    });
    await mount(library(api));
    await click(button("Use demo library"));
    expect(q('[data-testid="library-error"]')).toBeNull();
  });
});

describe("Shelf clamp", () => {
  const longText = "word ".repeat(120).trim();

  it("shows a Show full summary toggle only for long summaries and flips aria-expanded", async () => {
    const long = { ...card(ID_A, true), summary: { text: longText, savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-archivist" as const } };
    const api = fakeApi({ listDisks: () => Promise.resolve({ disks: [long, card(ID_B, true)] }) });
    await mount(library(api));
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="disk-card"]'));
    expect(cards[1]?.querySelector(".ec-toggle")).toBeNull();
    const first = cards[0] as HTMLElement;
    const text = first.querySelector<HTMLElement>('[data-testid="card-summary"]') as HTMLElement;
    expect(text.getAttribute("data-clamped")).toBe("true");
    const toggle = first.querySelector<HTMLButtonElement>(".ec-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toBe("Show full summary");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.textContent).toBe("Show less");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text.getAttribute("data-clamped")).toBe("false");
    expect(text.textContent).toBe(longText);
  });

  it("clamps long notes at two lines", async () => {
    const c = {
      ...card(ID_A, false),
      notes: [
        { id: "n1", text: "short", savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-undertaker" as const },
        { id: "n2", text: "a\nb\nc\nd\ne", savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-undertaker" as const },
      ],
    };
    await mount(library(fakeApi({ listDisks: () => Promise.resolve({ disks: [c] }) })));
    const toggles = container.querySelectorAll(".ec-toggle");
    expect(toggles.length).toBe(1);
    expect(toggles[0]?.textContent).toBe("Show full note");
  });
});

describe("Header and settings", () => {
  it("shows the title, subtitle and a decorative lantern", async () => {
    await mount(library(fakeApi()));
    expect(q("h1")?.textContent).toBe("Exhume Crew");
    expect(q(".ec-subtitle")?.textContent).toBe("A crew for a box of old floppy disks");
    expect(q(".ec-header-lantern")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps settings collapsed for a usable library and lets the user toggle", async () => {
    await mount(library(fakeApi()));
    const toggle = button("Library folder");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q("#ec-settings-body")?.hidden).toBe(true);
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(q("#ec-settings-body")?.hidden).toBe(false);
  });

  it("opens settings when no library is usable", async () => {
    const api = fakeApi({
      getLibrary: () => Promise.resolve({ path: "/gone", error: { code: "x", message: "missing" } }),
    });
    await mount(library(api));
    expect(button("Library folder").getAttribute("aria-expanded")).toBe("true");
    expect(q("#ec-settings-body")?.hidden).toBe(false);
  });
});

describe("Library cards and toolbar (task 22.4)", () => {
  const rich = (over: Partial<DiskCardView> = {}): DiskCardView => ({
    ...card(ID_A, false),
    label: "WRITERS",
    sizeBytes: 1474560,
    fileCount: 3,
    dateFirst: "1991-02-01",
    dateLast: "1992-03-04",
    counts: { alive: 1, recovered: 2, partial: 1, lost: 0 },
    ...over,
  });
  const mountCards = async (cards: DiskCardView[], onOpenDisk = vi.fn()): Promise<void> => {
    const api = fakeApi({ listDisks: () => Promise.resolve({ disks: cards }) });
    await mount(createElement(LibraryView, { api, onOpenDisk, onSummarise: vi.fn() }));
  };

  it("has an Open disk button that opens the disk on click and on keyboard activation", async () => {
    const onOpen = vi.fn();
    await mountCards([rich()], onOpen);
    const open = button("Open disk WRITERS");
    expect(open.textContent).toBe("Open disk");
    expect(q('[data-testid="disk-card"] h3')?.textContent).toBe("WRITERS");
    expect(container.querySelectorAll('[data-testid="disk-card"] > button').length).toBe(1);
    await click(open);
    expect(onOpen).toHaveBeenCalledWith(ID_A);
    // A native button turns Enter into a click; the keydown must not be swallowed.
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    open.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(open.tabIndex).toBe(0);
    expect(open.disabled).toBe(false);
  });

  it("shows recovered, partial and lost as badges with text, plus size and date range", async () => {
    await mountCards([rich()]);
    const badges = Array.from(container.querySelectorAll('[data-testid="card-counts"] .ec-badge[data-grade]'));
    expect(badges.map((b) => `${b.getAttribute("data-grade")}:${b.textContent}`)).toEqual([
      "recovered:Recovered 2",
      "partial:Partial 1",
      "lost:Lost 0",
    ]);
    expect(q('[data-testid="card-facts"]')?.textContent).toBe("1.4 MB | 3 files | 1991-02-01 to 1992-03-04");
  });

  it("falls back to no date when the card has no dates", async () => {
    await mountCards([rich({ dateFirst: null, dateLast: null })]);
    expect(q('[data-testid="card-facts"]')?.textContent).toContain("no date");
  });

  it("makes Summarise primary, groups the exports and keeps Rescan secondary", async () => {
    await mountCards([rich()]);
    expect(button("Summarise new disks").classList.contains("ec-btn-primary")).toBe(true);
    const group = q('[data-testid="export-group"]') as HTMLElement;
    expect(group.getAttribute("role")).toBe("group");
    const inGroup = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(inGroup).toEqual(["Export CSV", "Export Markdown"]);
    for (const t of ["Export CSV", "Export Markdown", "Rescan"]) {
      expect(button(t).classList.contains("ec-btn-secondary")).toBe(true);
      expect(button(t).classList.contains("ec-btn-primary")).toBe(false);
    }
    expect(group.contains(button("Rescan"))).toBe(false);
    expect(STYLE_TEXT).toContain(".ec-btn-primary");
  });

  it("renders a hostile label as text in the heading and the aria-label", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    await mountCards([rich({ label: evil })]);
    expect(q('[data-testid="disk-card"] h3')?.textContent).toBe(evil);
    expect(container.querySelector("img")).toBeNull();
    expect(button(`Open disk ${evil}`)).toBeTruthy();
  });
});

describe("Grave row", () => {
  it("makes the whole row a real button holding the name and the grade", async () => {
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail()),
      getPreview: () => Promise.reject(new Error("nope")),
    });
    await mount(diskView(api));
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="graveyard"] > li'));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const btn = row.querySelector("button");
      expect(btn).not.toBeNull();
      expect(row.querySelectorAll("button").length).toBe(1);
      expect(btn?.textContent).toContain(row.querySelector(".ec-grave-name")?.textContent ?? "?");
    }
    const grave = rows[1] as HTMLElement;
    expect(grave.querySelector("button")?.contains(grave.querySelector('[data-testid="grave-grade"]'))).toBe(true);
    // Clicking the grade text (not the file name) selects the row.
    await click(grave.querySelector<HTMLElement>(".ec-badge") as HTMLElement);
    expect(grave.getAttribute("data-selected")).toBe("true");
    expect(STYLE_TEXT).toMatch(/\.ec-grave-btn\s*\{[^}]*width: 100%/);
  });
});

describe("Disk view", () => {
  it("shows the not-found view for an unknown disk", async () => {
    const api = fakeApi({ listDisks: () => Promise.resolve({ disks: [card(ID_B, false)] }) });
    await mount(diskView(api));
    expect(q('[data-testid="disk-not-found"]')).not.toBeNull();
    expect(container.textContent).toContain("This disk does not exist.");
    expect(button("Back to library")).toBeTruthy();
  });

  it("shows the exhume-all tooltip text", async () => {
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail()),
    });
    await mount(diskView(api));
    const b = button("Exhume all recoverable");
    expect(b.getAttribute("title")).toBe(EXHUME_ALL_TOOLTIP);
    expect(EXHUME_ALL_TOOLTIP).toMatch(/live files/);
    expect(EXHUME_ALL_TOOLTIP).toMatch(/deleted entries graded recovered/);
    expect(container.querySelector("#ec-exhume-tip")?.textContent).toBe(EXHUME_ALL_TOOLTIP);
  });

  it("lists results after exhume all and disables the button while it runs", async () => {
    let finish: (r: { results: ExhumeOutcome[] }) => void = () => undefined;
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail()),
      exhumeAll: () => new Promise((res) => (finish = res)),
    });
    await mount(diskView(api));
    await click(button("Exhume all recoverable"));
    expect(button("Exhume all recoverable").disabled).toBe(true);
    await act(async () => {
      finish({
        results: [
          { entry: 1, path: "A.TXT", outcome: "exhumed" },
          { entry: 2, path: "GONE.TXT", outcome: "failed", errorCode: "x" },
        ],
      });
    });
    await flush();
    const items = Array.from(container.querySelectorAll('[data-testid="exhume-results"] li')).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["A.TXT: succeeded", "GONE.TXT: failed (x)"]);
    expect(button("Exhume all recoverable").disabled).toBe(false);
  });

  describe("exhume-all destinations", () => {
    async function runExhume(results: ExhumeOutcome[], files: FileEntry[], libPath = "/my/lib"): Promise<ExhumeApi> {
      const api = fakeApi({
        getLibrary: () => Promise.resolve({ path: libPath, error: null }),
        listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
        getDisk: () => Promise.resolve(detail({ files, totalEntries: files.length })),
        exhumeAll: () => Promise.resolve({ results }),
        getPreview: () => Promise.reject(new Error("nope")),
      });
      await mount(diskView(api));
      await click(button("Exhume all recoverable"));
      return api;
    }
    const items = (): (string | null)[] =>
      Array.from(container.querySelectorAll('[data-testid="exhume-results"] li')).map((li) => li.textContent);

    it("shows source -> output path, collision names and failure reasons", async () => {
      await runExhume(
        [
          { entry: 1, path: "README.TXT", outcome: "exhumed", outputPath: "exhumed/README.txt" },
          { entry: 2, path: "SUB/README.TXT", outcome: "exhumed", outputPath: "exhumed/README-1.txt" },
          { entry: 3, path: "BAD.BIN", outcome: "failed", errorCode: "NO_CONVERTER" },
        ],
        [file(1, "README.TXT"), file(2, "SUB/README.TXT"), file(3, "BAD.BIN", "recovered")],
      );
      expect(items()).toEqual([
        "README.TXT -> exhumed/README.txt",
        "SUB/README.TXT -> exhumed/README-1.txt",
        "BAD.BIN: failed (NO_CONVERTER)",
      ]);
    });

    it("shows the real library path line and does not leak absolute output paths", async () => {
      await runExhume(
        [{ entry: 1, path: "A.TXT", outcome: "exhumed", outputPath: "/my/lib/exhumed/A-1.txt" }],
        [file(1, "A.TXT")],
      );
      expect(q('[data-testid="exhume-location"]')?.textContent).toBe("Exhumed files are in /my/lib/exhumed/");
      expect(items()).toEqual(["A.TXT -> exhumed/A-1.txt"]);
    });

    it("keeps results after selecting a preview", async () => {
      await runExhume([{ entry: 1, path: "A.TXT", outcome: "exhumed", outputPath: "exhumed/A.txt" }], [file(1, "A.TXT")]);
      await click(button("Tombstone: A.TXT"));
      expect(items()).toEqual(["A.TXT -> exhumed/A.txt"]);
    });

    it("renders hostile names as text", async () => {
      const evil = "<img src=x onerror=alert(1)>.TXT";
      await runExhume(
        [{ entry: 1, path: evil, outcome: "exhumed", outputPath: "exhumed/<b>x</b>.txt" }],
        [file(1, evil)],
        "/lib/<i>x</i>",
      );
      expect(container.querySelector('[data-testid="exhume-results"] img, [data-testid="exhume-results"] b')).toBeNull();
      expect(q('[data-testid="exhume-location"] i')).toBeNull();
      expect(items()).toEqual([`${evil} -> exhumed/<b>x</b>.txt`]);
      expect(q('[data-testid="exhume-location"]')?.textContent).toContain("/lib/<i>x</i>/exhumed/");
    });
  });

  it("keeps the file list usable when a preview fails", async () => {
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail()),
      getPreview: () => Promise.reject(new Error("nope")),
    });
    await mount(diskView(api));
    await click(button("Tombstone: A.TXT"));
    expect(container.textContent).toContain("The preview could not be loaded.");
    expect(q('[data-testid="graveyard"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="graveyard"] li').length).toBe(2);
    // Another file can still be selected.
    const ok: PreviewResponse = { kind: "text", format: "text", text: "hi", truncated: false, warnings: [] };
    api.getPreview = () => Promise.resolve(ok);
    await click(button("Open grave: GONE.TXT"));
    expect(q('[data-testid="preview-text"]')?.textContent).toBe("hi");
  });

  const truncApi = (truncated: boolean): ExhumeApi =>
    fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail({ truncated, totalEntries: 9000 })),
    });

  it("shows the truncation notice when the listing is truncated", async () => {
    await mount(diskView(truncApi(true)));
    expect(q('[data-testid="truncation-notice"]')?.textContent).toContain("of 9000 entries");
  });

  it("shows no truncation notice when the listing is complete", async () => {
    await mount(diskView(truncApi(false)));
    expect(q('[data-testid="truncation-notice"]')).toBeNull();
  });

  it("asks the undertaker with the disk id", async () => {
    const onAsk = vi.fn();
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [card(ID_A, false)] }),
      getDisk: () => Promise.resolve(detail()),
    });
    await mount(diskView(api, onAsk));
    await click(button("Ask the undertaker"));
    expect(onAsk).toHaveBeenCalledWith(ID_A);
  });
});

describe("Disk page layout (22.3)", () => {
  function richCard(over: Partial<DiskCardView> = {}): DiskCardView {
    return {
      ...card(ID_A, true),
      label: "WRITERS",
      relPath: "writers-disk.img",
      sizeBytes: 1474560,
      geometry: { source: "bpb", label: '1.44 MB 3.5"' },
      fileCount: 3,
      dateFirst: "1991-02-01",
      dateLast: "1993-06-30",
      counts: { alive: 2, recovered: 3, partial: 1, lost: 2 },
      warnings: [{ code: "w", message: "FAT copies differ" }],
      notes: [{ id: "n1", text: "note one", savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-undertaker" }],
      ...over,
    };
  }
  const entries: FileEntry[] = [
    { id: 1, path: "LETTER.WS", kind: "file", state: "alive", size: 2048, date: "1991-02-01" },
    { id: 2, path: "DATA.DBF", kind: "file", state: "recovered", size: 10, date: null },
    { id: 3, path: "PIC.PCX", kind: "file", state: "partial", size: 10, date: null },
    { id: 4, path: "README.TXT", kind: "file", state: "alive", size: 10, date: null },
    { id: 5, path: "GONE.WS", kind: "file", state: "lost", size: 10, date: null },
    { id: 6, path: "DOCS", kind: "directory", state: "alive", size: 0, date: "1991-02-01" },
  ];
  const open = async (c: DiskCardView, files: FileEntry[] = entries): Promise<void> => {
    const api = fakeApi({
      listDisks: () => Promise.resolve({ disks: [c] }),
      getDisk: () => Promise.resolve(detail({ card: c, files, totalEntries: files.length })),
      getPreview: () => Promise.reject(new Error("nope")),
    });
    await mount(diskView(api));
  };

  it("shows the label as the page heading and falls back to relPath", async () => {
    await open(richCard());
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(q("h1")?.textContent).toBe("WRITERS");
    expect(q('[data-testid="disk-relpath"]')?.textContent).toBe("writers-disk.img");
    await act(async () => root.unmount());
    root = createRoot(container);
    await open(richCard({ label: "" }));
    expect(q("h1")?.textContent).toBe("writers-disk.img");
  });

  it("shows facts, graded count badges with text, warnings, summary and notes", async () => {
    await open(richCard());
    const facts = Array.from(container.querySelectorAll('[data-testid="disk-facts"] li')).map((li) => li.textContent);
    expect(facts).toEqual(["1.4 MB", '1.44 MB 3.5"', "3 files", "1991-02-01 to 1993-06-30"]);
    const badges = Array.from(container.querySelectorAll('[data-testid="count-badges"] .ec-badge')).map(
      (b) => [b.getAttribute("data-grade"), b.textContent],
    );
    expect(badges).toEqual([
      ["recovered", "Recovered 3"],
      ["partial", "Partial 1"],
      ["lost", "Lost 2"],
    ]);
    expect(q('[data-testid="disk-warnings"]')?.textContent).toBe("FAT copies differ");
    expect(q('[data-testid="disk-summary"]')?.textContent).toBe("s");
    expect(q('[data-testid="disk-notes"]')?.textContent).toContain("note one");
  });

  it("clamps a long summary with a Show full summary toggle", async () => {
    const text = "word ".repeat(120).trim();
    await open(richCard({ summary: { text, savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-archivist" } }));
    const p = q('[data-testid="disk-summary"]') as HTMLElement;
    expect(p.getAttribute("data-clamped")).toBe("true");
    await click(button("Show full summary"));
    expect(p.getAttribute("data-clamped")).toBe("false");
  });

  it("shows the conversion for known formats and only size and date otherwise", async () => {
    await open(richCard());
    const meta = (path: string): string =>
      q(`[data-testid="graveyard"] li [aria-label$="${path}"] [data-testid="grave-meta"]`)?.textContent ?? "";
    expect(meta("LETTER.WS")).toBe("2 KB | 1991-02-01 | Converts: WordStar -> Markdown");
    expect(meta("DATA.DBF")).toBe("10 B | no date | Converts: dBase -> CSV");
    expect(meta("PIC.PCX")).toBe("10 B | no date | Converts: PCX -> PNG");
    expect(meta("README.TXT")).toBe("10 B | no date | Converts: text");
    // A lost file cannot be converted.
    expect(meta("GONE.WS")).toBe("10 B | no date");
  });

  it("renders a directory with a folder mark and no button", async () => {
    await open(richCard());
    const dir = q('[data-testid="directory"]') as HTMLElement;
    expect(dir.textContent).toContain("DOCS");
    expect(dir.querySelector("button")).toBeNull();
    expect(dir.querySelector(".ec-grave-mark")?.getAttribute("data-shape")).toBe("folder");
    expect(dir.querySelector(".ec-grave-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll('[data-testid="graveyard"] button').length).toBe(5);
  });

  it("shows grade badges with their text on deleted rows", async () => {
    await open(richCard());
    const grave = q('[data-testid="open-grave"]') as HTMLElement;
    const badge = grave.querySelector(".ec-badge") as HTMLElement;
    expect(badge.getAttribute("data-grade")).toBe("recovered");
    expect(badge.textContent).toBe("Grade: recovered");
  });

  it("renders hostile label, relPath, warnings, notes and file names as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    await open(
      richCard({
        label: evil,
        relPath: "<b>r</b>.img",
        warnings: [{ code: "w", message: "<script>1</script>" }],
        notes: [{ id: "n1", text: "<i>n</i>", savedAt: "2024-01-01T00:00:00.000Z", agent: "exhume-undertaker" }],
      }),
      [file(1, "<u>x</u>.WS"), { ...file(2, "<em>d</em>"), kind: "directory" }],
    );
    expect(container.querySelector("img, b, script, i, u, em")).toBeNull();
    expect(q("h1")?.textContent).toBe(evil);
    expect(q('[data-testid="disk-relpath"]')?.textContent).toBe("<b>r</b>.img");
    expect(q('[data-testid="disk-warnings"]')?.textContent).toBe("<script>1</script>");
    expect(q('[data-testid="disk-notes"]')?.textContent).toContain("<i>n</i>");
    expect(q('[data-testid="tombstone"] .ec-grave-name')?.textContent).toBe("<u>x</u>.WS");
    expect(q('[data-testid="directory"] .ec-grave-name')?.textContent).toBe("<em>d</em>");
  });

  it("puts the preview in a column that is sticky from 1100px up", () => {
    expect(STYLE_TEXT).toMatch(/@media \(min-width: 1100px\)\s*\{[^@]*\.ec-disk-side\s*\{[^}]*position: sticky/);
    expect(STYLE_TEXT).toMatch(/@media \(min-width: 1100px\)\s*\{[^@]*grid-template-columns/);
  });

  it("has an exact grade colour for each state in both modes", () => {
    for (const g of ["recovered", "partial", "lost"]) {
      expect(STYLE_TEXT).toMatch(new RegExp(`\\.ec-badge\\[data-grade="${g}"\\] \\{ background: #[0-9a-f]{6}; color: #[0-9a-f]{6}`));
      expect(STYLE_TEXT).toMatch(new RegExp(`\\[data-mode="dark"\\] \\.ec-badge\\[data-grade="${g}"\\]`));
    }
  });
});

describe("Format helpers", () => {
  it("formats sizes, ranges and conversions", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1474560)).toBe("1.4 MB");
    expect(formatDateRange("a", "a")).toBe("a");
    expect(formatDateRange(null, "b")).toBe("b");
    expect(formatDateRange(null, null)).toBeNull();
    expect(conversionFor("x.pcx")).toBe("PCX -> PNG");
    expect(conversionFor("x.bin")).toBeNull();
    expect(conversionFor("noext")).toBeNull();
  });
});

describe("Styles", () => {
  it("uses exactly one style element's text with no interpolation marker", () => {
    expect(STYLE_TEXT).not.toContain("${");
  });

  it("puts decorative keyframes inside a prefers-reduced-motion: no-preference rule", () => {
    const start = STYLE_TEXT.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(start).toBeGreaterThanOrEqual(0);
    const firstKeyframes = STYLE_TEXT.indexOf("@keyframes");
    expect(firstKeyframes).toBeGreaterThan(start);
    // Every animation and keyframes occurrence is after the media rule starts.
    for (const m of STYLE_TEXT.matchAll(/@keyframes|animation:/g)) {
      expect(m.index).toBeGreaterThan(start);
    }
  });

  it("defines a 2px focus-visible outline", () => {
    expect(STYLE_TEXT).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid/);
  });
});
