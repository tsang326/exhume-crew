/**
 * Library page: SettingsArea, Toolbar, ScanProgress, EmptyState and the shelf of disk cards
 * (Requirements 3.10, 13.1 to 13.10). Untrusted text is only ever a React text child.
 * All network access goes through the injected `ExhumeApi`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { DiskCardView, ScanStatus } from "../../src/shared/schema";
import type { ExhumeApi, LibraryStatus } from "./lib/api";
import { CountBadges } from "./Badges";
import { Lantern } from "./Lantern";
import { formatBytes, formatDateRange, formatFileCount } from "./lib/format";
import { buildSummariseMessage, isValidDiskId } from "./lib/messages";

const GENERIC_SAVE_ERROR = "The library folder could not be set.";
const MAX_ERROR_TEXT = 300;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim() !== "") return err.message.slice(0, MAX_ERROR_TEXT);
  return fallback;
}

// ------------------------------------------------------------------ Header

/** Small title area: lantern, title and a one-line subtitle. The lantern is decoration only. */
export function Header({ mode = "dark" }: { mode?: "dark" | "light" }): ReactElement {
  return (
    <header className="ec-header" data-testid="app-header">
      <div>
        <h1 className="ec-title">Exhume Crew</h1>
        <p className="ec-subtitle">A crew for a box of old floppy disks</p>
      </div>
      <Lantern lit={mode === "dark"} />
    </header>
  );
}

// ------------------------------------------------------------------ ClampText

/** True when the element's content is taller than its box (1 px tolerance). No layout gives false. */
function isClipped(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

/**
 * Text clamped to `lines` lines with a real expand button. The button shows only when the text is
 * really clipped: it is measured with the clamp applied, after render and on resize. While
 * expanded the last collapsed measurement is kept, so the user can always collapse again.
 */
export function ClampText(props: {
  text: string;
  lines: number;
  testId?: string;
  className?: string;
  expandLabel: string;
  collapseLabel: string;
}): ReactElement {
  const { text, lines, testId, className, expandLabel, collapseLabel } = props;
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // Measure while collapsed (the clamp is applied then); skip while expanded.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || expanded) return;
    setClipped(isClipped(el));
  }, [text, lines, expanded]);

  useEffect(() => {
    const measure = (): void => {
      const el = ref.current;
      if (el !== null && !expandedRef.current) setClipped(isClipped(el));
    };
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && ref.current !== null) {
      observer = new ResizeObserver(measure);
      observer.observe(ref.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <p
        ref={ref}
        className={`ec-clamp${className ? ` ${className}` : ""}`}
        data-testid={testId}
        data-lines={String(lines)}
        data-clamped={expanded ? "false" : "true"}
      >
        {text}
      </p>
      {clipped ? (
        <button
          className="ec-btn ec-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ SettingsArea

export interface SettingsAreaProps {
  library: LibraryStatus | null;
  disabled: boolean;
  saveError: string | null;
  demoError: string | null;
  onSave: (path: string) => void;
  onUseDemo: () => void;
}

export function SettingsArea(props: SettingsAreaProps): ReactElement {
  const { library, disabled, saveError, demoError, onSave, onUseDemo } = props;
  const [path, setPath] = useState("");
  const shownPath = library?.path ?? "";
  useEffect(() => {
    setPath(shownPath);
  }, [shownPath]);

  // Open only while no library is usable, unless the user has toggled it.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const usable = library !== null && library.path !== null && library.error === null;
  const open = userOpen ?? (library !== null && !usable);

  return (
    <section className="ec-card" aria-label="Settings" data-testid="settings-area">
      <h2 className="ec-settings-title">
        <button
          className="ec-btn ec-settings-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="ec-settings-body"
          onClick={() => setUserOpen(!open)}
        >
          Library folder
        </button>
      </h2>
      <div id="ec-settings-body" hidden={!open} data-testid="settings-body">
      <form
        className="ec-row"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(path);
        }}
      >
        <label htmlFor="ec-library-path">Library path</label>
        <input
          id="ec-library-path"
          className="ec-input"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button className="ec-btn" type="submit" disabled={disabled || path.trim() === ""}>
          Save
        </button>
        <button className="ec-btn" type="button" disabled={disabled} onClick={onUseDemo}>
          Use demo library
        </button>
      </form>
      <p className="ec-muted">
        Current library: <span data-testid="library-path">{library?.path ?? "not set"}</span>
      </p>
      {library?.error ? (
        <p role="alert" className="ec-error" data-testid="library-error">
          {library.error.message}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="ec-error">
          {saveError}
        </p>
      ) : null}
      {demoError ? (
        <p role="alert" className="ec-error">
          {demoError}
        </p>
      ) : null}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Toolbar

export interface ToolbarProps {
  scanning: boolean;
  hasDisks: boolean;
  onRescan: () => void;
  onExportCsv: () => void;
  onExportMarkdown: () => void;
  onSummarise: () => void;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  const { scanning, hasDisks, onRescan, onExportCsv, onExportMarkdown, onSummarise } = props;
  const needDisks = scanning || !hasDisks;
  return (
    <div className="ec-row" role="toolbar" aria-label="Library actions">
      <button className="ec-btn ec-btn-primary" type="button" disabled={needDisks} onClick={onSummarise}>
        Summarise new disks
      </button>
      <div className="ec-btn-group" role="group" aria-label="Export" data-testid="export-group">
        <button className="ec-btn ec-btn-secondary" type="button" disabled={needDisks} onClick={onExportCsv}>
          Export CSV
        </button>
        <button className="ec-btn ec-btn-secondary" type="button" disabled={needDisks} onClick={onExportMarkdown}>
          Export Markdown
        </button>
      </div>
      <button className="ec-btn ec-btn-secondary" type="button" disabled={scanning} onClick={onRescan}>
        Rescan
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ ScanProgress

export function ScanProgress({ scan }: { scan: ScanStatus | null }): ReactElement | null {
  if (scan === null) return null;
  if (scan.state === "running") {
    return (
      <p role="status" data-testid="scan-progress">
        {`Scanned ${scan.scanned} of ${scan.total} disks`}
      </p>
    );
  }
  if (scan.state === "failed") {
    return (
      <p role="alert" className="ec-error" data-testid="scan-error">
        The scan failed.
      </p>
    );
  }
  return null;
}

// ------------------------------------------------------------------ EmptyState

export function EmptyState({ disabled, onUseDemo }: { disabled: boolean; onUseDemo: () => void }): ReactElement {
  return (
    <section className="ec-card" aria-label="Empty library" data-testid="empty-state">
      <h2>No disks yet</h2>
      <p>
        Put disk image files (.img) into your library folder and press Rescan, or type a different
        folder in the settings above and press Save.
      </p>
      <button className="ec-btn" type="button" disabled={disabled} onClick={onUseDemo}>
        Use demo library
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ Shelf

export function DiskCard({ card, onOpen }: { card: DiskCardView; onOpen: (id: string) => void }): ReactElement {
  const name = card.label === "" ? "Untitled disk" : card.label;
  return (
    <li className="ec-card ec-disk" data-testid="disk-card">
      <span className="ec-disk-shutter" aria-hidden="true" />
      <h3 className="ec-disk-label">{name}</h3>
      <p className="ec-disk-facts" data-testid="card-facts">
        {`${formatBytes(card.sizeBytes)} | ${formatFileCount(card.fileCount)} | ${formatDateRange(card.dateFirst, card.dateLast) ?? "no date"}`}
      </p>
      <p>
        <span className="ec-badge" data-testid="card-status">
          {card.status}
        </span>
      </p>
      <p className="ec-disk-counts" data-testid="card-counts">
        <CountBadges counts={card.counts} />
      </p>
      <p data-testid="card-warnings">{`Warnings: ${card.warnings.length}`}</p>
      <button
        className="ec-btn ec-btn-secondary ec-btn-open"
        type="button"
        aria-label={`Open disk ${name}`}
        onClick={() => onOpen(card.diskId)}
      >
        Open disk
      </button>
      {card.summary ? (
        <ClampText
          text={card.summary.text}
          lines={4}
          testId="card-summary"
          expandLabel="Show full summary"
          collapseLabel="Show less"
        />
      ) : (
        <p data-testid="card-summary" className="ec-muted">
          No summary yet
        </p>
      )}
      {card.notes.length > 0 ? (
        <ul data-testid="card-notes">
          {card.notes.map((n) => (
            <li key={n.id}>
              <ClampText
                text={n.text}
                lines={2}
                expandLabel="Show full note"
                collapseLabel="Show less"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="card-notes" className="ec-muted">
          No notes yet
        </p>
      )}
    </li>
  );
}

export function Shelf({ disks, onOpen }: { disks: DiskCardView[]; onOpen: (id: string) => void }): ReactElement {
  return (
    <ul className="ec-shelf" aria-label="Disks" data-testid="shelf">
      {disks.map((c) => (
        <DiskCard key={c.diskId} card={c} onOpen={onOpen} />
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ LibraryView

export interface LibraryViewProps {
  api: ExhumeApi;
  onOpenDisk: (id: string) => void;
  /** Opens a chat with the Archivist with the given fixed message. */
  onSummarise: (message: string) => void;
  /** Theme mode; the lantern is lit in dark and unlit in light. Defaults to dark. */
  mode?: "dark" | "light";
}

export function LibraryView({ api, onOpenDisk, onSummarise, mode = "dark" }: LibraryViewProps): ReactElement {
  const [library, setLibrary] = useState<LibraryStatus | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [disks, setDisks] = useState<DiskCardView[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refreshDisks = useCallback(async (): Promise<void> => {
    try {
      const r = await api.listDisks();
      if (live.current) setDisks(r.disks);
    } catch {
      if (live.current) setNotice("The disk list could not be loaded.");
    }
  }, [api]);

  const refreshScan = useCallback(async (): Promise<void> => {
    try {
      const s = await api.getScan();
      if (live.current) setScan(s);
    } catch {
      // Keep the previous scan status.
    }
  }, [api]);

  useEffect(() => {
    api.getLibrary().then(
      (l) => {
        if (live.current) setLibrary(l);
      },
      () => {
        if (live.current) setNotice("The library folder could not be read.");
      },
    );
    void refreshScan();
    void refreshDisks();
  }, [api, refreshDisks, refreshScan]);

  const scanning = scan?.state === "running";

  // Poll once per second while a scan runs; refresh the shelf when it stops.
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => {
      api.getScan().then(
        (s) => {
          if (!live.current) return;
          setScan(s);
          if (s.state !== "running") void refreshDisks();
        },
        () => {
          // Try again on the next tick.
        },
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [api, scanning, refreshDisks]);

  const startScan = useCallback(async (): Promise<void> => {
    try {
      await api.startScan();
    } catch {
      if (live.current) setNotice("The scan could not be started.");
    }
    await refreshScan();
  }, [api, refreshScan]);

  const onSave = (path: string): void => {
    setSaveError(null);
    setBusy(true);
    api.setLibrary(path).then(
      async (l) => {
        if (!live.current) return;
        setLibrary({ ...l, error: null });
        setBusy(false);
        await refreshScan();
        await refreshDisks();
      },
      (err: unknown) => {
        if (!live.current) return;
        setBusy(false);
        setSaveError(errorText(err, GENERIC_SAVE_ERROR));
      },
    );
  };

  const onUseDemo = (): void => {
    setDemoError(null);
    setBusy(true);
    api
      .copyDemoLibrary()
      .then(async () => {
        if (live.current) setLibrary((prev) => (prev === null ? prev : { ...prev, error: null }));
        try {
          const fresh = await api.getLibrary();
          // A valid later status replaces the old one, which drops any stale error.
          if (live.current && fresh.path !== null && fresh.error === null) setLibrary(fresh);
        } catch {
          // Keep the cleared status.
        }
        await startScan();
        await refreshDisks();
      })
      .catch(() => {
        if (live.current) setDemoError("Copying the demo library failed.");
      })
      .finally(() => {
        if (live.current) setBusy(false);
      });
  };

  const exportWith = (run: () => Promise<void>): void => {
    setNotice(null);
    run().catch(() => {
      if (live.current) setNotice("The export failed.");
    });
  };

  const onSummariseNew = (): void => {
    const ids = (disks ?? []).filter((d) => d.summary === null && isValidDiskId(d.diskId)).map((d) => d.diskId);
    const message = buildSummariseMessage(ids);
    if (message === null) {
      setNotice("There are no new disks to summarise.");
      return;
    }
    setNotice(null);
    onSummarise(message);
  };

  const hasDisks = disks !== null && disks.length > 0;

  return (
    <div className="ec-content" data-testid="library-view">
      <Header mode={mode} />
      <SettingsArea
        library={library}
        disabled={busy}
        saveError={saveError}
        demoError={demoError}
        onSave={onSave}
        onUseDemo={onUseDemo}
      />
      <Toolbar
        scanning={scanning}
        hasDisks={hasDisks}
        onRescan={() => void startScan()}
        onExportCsv={() => exportWith(() => api.downloadCsv())}
        onExportMarkdown={() => exportWith(() => api.downloadMarkdown())}
        onSummarise={onSummariseNew}
      />
      <ScanProgress scan={scan} />
      <div role="status" data-testid="notice">
        {notice}
      </div>
      {disks !== null && disks.length === 0 ? <EmptyState disabled={busy} onUseDemo={onUseDemo} /> : null}
      {disks !== null && disks.length > 0 ? <Shelf disks={disks} onOpen={onOpenDisk} /> : null}
    </div>
  );
}
