/**
 * Library page: SettingsArea, Toolbar, ScanProgress, EmptyState and the shelf of disk cards
 * (Requirements 3.10, 13.1 to 13.10). Untrusted text is only ever a React text child.
 * All network access goes through the injected `ExhumeApi`.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { DiskCardView, ScanStatus } from "../../src/shared/schema";
import type { ExhumeApi, LibraryStatus } from "./lib/api";
import { buildSummariseMessage, isValidDiskId } from "./lib/messages";

const GENERIC_SAVE_ERROR = "The library folder could not be set.";
const MAX_ERROR_TEXT = 300;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim() !== "") return err.message.slice(0, MAX_ERROR_TEXT);
  return fallback;
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

  return (
    <section className="ec-card" aria-label="Settings" data-testid="settings-area">
      <h2>Library folder</h2>
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
      <button className="ec-btn" type="button" disabled={scanning} onClick={onRescan}>
        Rescan
      </button>
      <button className="ec-btn" type="button" disabled={needDisks} onClick={onExportCsv}>
        Export CSV
      </button>
      <button className="ec-btn" type="button" disabled={needDisks} onClick={onExportMarkdown}>
        Export Markdown
      </button>
      <button className="ec-btn" type="button" disabled={needDisks} onClick={onSummarise}>
        Summarise new disks
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
  return (
    <li className="ec-card ec-disk" data-testid="disk-card">
      <span className="ec-disk-shutter" aria-hidden="true" />
      <h3 className="ec-disk-label">
        <button className="ec-btn" type="button" onClick={() => onOpen(card.diskId)}>
          {card.label === "" ? "Untitled disk" : card.label}
        </button>
      </h3>
      <p>
        <span className="ec-badge" data-testid="card-status">
          {card.status}
        </span>
      </p>
      <p data-testid="card-counts">
        {`Recovered ${card.counts.recovered}, partial ${card.counts.partial}, lost ${card.counts.lost}`}
      </p>
      <p data-testid="card-warnings">{`Warnings: ${card.warnings.length}`}</p>
      <p data-testid="card-summary" className={card.summary ? undefined : "ec-muted"}>
        {card.summary ? card.summary.text : "No summary yet"}
      </p>
      {card.notes.length > 0 ? (
        <ul data-testid="card-notes">
          {card.notes.map((n) => (
            <li key={n.id}>{n.text}</li>
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
}

export function LibraryView({ api, onOpenDisk, onSummarise }: LibraryViewProps): ReactElement {
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
      <h1>Exhume Crew</h1>
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
