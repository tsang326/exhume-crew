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
    expect(items).toEqual(["A.TXT: succeeded", "GONE.TXT: failed"]);
    expect(button("Exhume all recoverable").disabled).toBe(false);
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

describe("Styles", () => {
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
