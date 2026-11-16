/**
 * Disk page: graveyard of tombstones (live files) and open graves (deleted entries), preview,
 * "Exhume all recoverable" and "Ask the undertaker" (Requirements 14.1 to 14.12).
 * Untrusted text (labels, file names, reasons) is only ever a React text child.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { DiskCardView, FileEntry } from "../../src/shared/schema";
import type { DiskDetail, ExhumeApi, ExhumeOutcome } from "./lib/api";
import { PreviewPane } from "./PreviewPane";
import { CountBadges, GradeBadge } from "./Badges";
import { ClampText } from "./LibraryView";
import {
  conversionFor,
  formatBytes,
  formatDateRange,
  formatDateTime,
  formatFileCount,
  formatGeometry,
} from "./lib/format";

export const EXHUME_ALL_TOOLTIP =
  "Exhumes live files and deleted entries graded recovered.";

type Load =
  | { phase: "loading" }
  | { phase: "notfound" }
  | { phase: "error" }
  | { phase: "ready"; detail: DiskDetail };

type ExhumeState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "error" }
  | { phase: "done"; results: ExhumeOutcome[] };

/**
 * Display form of an output path: `exhumed/<name>` onward. The API returns the relative form;
 * if an absolute path ever arrives, only the part after the exhumed folder is shown.
 */
/** Exhume names a byte-for-byte copy `NAME.EXT.bin`; no converter writes `.bin`. */
export function isOriginalCopy(outputPath: string): boolean {
  return outputPath.toLowerCase().endsWith(".bin");
}

export function relativeOutput(outputPath: string): string {
  const norm = outputPath.replace(/\\/g, "/");
  if (norm.startsWith("exhumed/")) return norm;
  const at = norm.lastIndexOf("/exhumed/");
  if (at >= 0) return norm.slice(at + 1);
  return norm.startsWith("/") || /^[A-Za-z]:\//.test(norm) ? (norm.split("/").pop() ?? norm) : norm;
}

/** Deterministic stone height step (0 to 3) from the entry index; CSS maps it to 26, 32, 38, 30 px. */
export function stoneHeight(index: number): number {
  return Math.abs(index) % 4;
}

export function Grave({
  entry,
  selected,
  onSelect,
  index = 0,
}: {
  entry: FileEntry;
  selected: boolean;
  onSelect: (id: number) => void;
  index?: number;
}): ReactElement {
  const deleted = entry.state !== "alive";
  const isFile = entry.kind === "file";
  const label = deleted ? `Open grave: ${entry.path}` : `Tombstone: ${entry.path}`;
  // One text child: size, date and (files that can be read) the conversion Exhume applies.
  const conversion = isFile && entry.state !== "lost" ? conversionFor(entry.path) : null;
  const meta = [
    isFile ? formatBytes(entry.size) : "folder",
    formatDateTime(entry.date) ?? "no date",
    ...(conversion !== null ? [`Converts: ${conversion}`] : []),
  ].join(" | ");
  const body = (
    <>
      <span className="ec-grave-name">{entry.path}</span>
      <span className="ec-grave-meta ec-muted" data-testid="grave-meta">
        {meta}
      </span>
      {deleted ? (
        <span className="ec-grave-grade" data-testid="grave-grade">
          <GradeBadge grade={entry.state} text={`Grade: ${entry.state}`} />
          {entry.reason !== undefined ? <span>{` ${entry.reason}`}</span> : null}
        </span>
      ) : null}
    </>
  );
  return (
    <li
      className="ec-grave"
      data-testid={isFile ? (deleted ? "open-grave" : "tombstone") : "directory"}
      data-selected={selected ? "true" : "false"}
    >
      <span
        className="ec-grave-mark"
        aria-hidden="true"
        data-shape={!isFile ? "folder" : deleted ? "pit" : "stone"}
        data-h={isFile && !deleted ? String(stoneHeight(index)) : undefined}
      />
      {isFile ? (
        <button
          className="ec-grave-btn"
          type="button"
          aria-pressed={selected}
          aria-label={label}
          onClick={() => onSelect(entry.id)}
        >
          {body}
        </button>
      ) : (
        <div className="ec-grave-static">{body}</div>
      )}
    </li>
  );
}

export function Graveyard({
  files,
  selected,
  onSelect,
}: {
  files: FileEntry[];
  selected: number | null;
  onSelect: (id: number) => void;
}): ReactElement {
  return (
    <ul className="ec-graveyard" aria-label="Graveyard" data-testid="graveyard">
      {files.map((f, i) => (
        <Grave key={f.id} entry={f} index={i} selected={selected === f.id} onSelect={onSelect} />
      ))}
    </ul>
  );
}

/** Page heading, facts row, grade badges, warnings, Summary and Notes of one disk. */
export function DiskHeader({ card }: { card: DiskCardView }): ReactElement {
  const range = formatDateRange(card.dateFirst, card.dateLast);
  const facts = [
    formatBytes(card.sizeBytes),
    formatGeometry(card.geometry),
    formatFileCount(card.fileCount),
    range ?? "no dates",
  ];
  return (
    <header className="ec-diskhead" data-testid="disk-header">
      <h1 className="ec-title" data-testid="disk-title">
        {card.label === "" ? card.relPath : card.label}
      </h1>
      {card.label !== "" ? (
        <p className="ec-subtitle ec-muted" data-testid="disk-relpath">
          {card.relPath}
        </p>
      ) : null}
      <ul className="ec-facts" aria-label="Disk facts" data-testid="disk-facts">
        {facts.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
      <CountBadges counts={card.counts} />
      {card.warnings.length > 0 ? (
        <ul className="ec-warnings" aria-label="Warnings" data-testid="disk-warnings">
          {card.warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      ) : null}
      {card.summary ? (
        <ClampText
          text={card.summary.text}
          lines={4}
          testId="disk-summary"
          expandLabel="Show full summary"
          collapseLabel="Show less"
        />
      ) : (
        <p className="ec-muted" data-testid="disk-summary">
          No summary yet
        </p>
      )}
      {card.notes.length > 0 ? (
        <section aria-label="Notes" data-testid="disk-notes">
          <h2 className="ec-settings-title">Notes</h2>
          <ul className="ec-notes">
            {card.notes.map((n) => (
              <li key={n.id}>
                <ClampText text={n.text} lines={2} expandLabel="Show full note" collapseLabel="Show less" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </header>
  );
}

export function NotFound({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <div className="ec-content" data-testid="disk-not-found">
      <button className="ec-btn" type="button" onClick={onBack}>
        Back to library
      </button>
      <p role="alert" className="ec-error">
        This disk does not exist.
      </p>
    </div>
  );
}

export interface DiskViewProps {
  api: ExhumeApi;
  diskId: string;
  onBack: () => void;
  /** Opens a chat with the Undertaker for the disk id. */
  onAskUndertaker: (diskId: string) => void;
}

export function DiskView({ api, diskId, onBack, onAskUndertaker }: DiskViewProps): ReactElement {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [exhume, setExhume] = useState<ExhumeState>({ phase: "idle" });
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    api.getLibrary().then(
      (l) => {
        if (live.current) setLibraryPath(l.path);
      },
      () => undefined,
    );
  }, [api]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoad({ phase: "loading" });
    setSelected(null);
    setExhume({ phase: "idle" });
    (async () => {
      try {
        const list = await api.listDisks();
        if (!current) return;
        if (!list.disks.some((d) => d.diskId === diskId)) {
          setLoad({ phase: "notfound" });
          return;
        }
        const detail = await api.getDisk(diskId);
        if (current) setLoad({ phase: "ready", detail });
      } catch {
        if (current) setLoad({ phase: "error" });
      }
    })();
    return () => {
      current = false;
    };
  }, [api, diskId]);

  if (load.phase === "notfound") return <NotFound onBack={onBack} />;

  if (load.phase !== "ready") {
    return (
      <div className="ec-content" data-testid="disk-view">
        <button className="ec-btn" type="button" onClick={onBack}>
          Back to library
        </button>
        {load.phase === "loading" ? (
          <p role="status">Loading disk...</p>
        ) : (
          <p role="alert" className="ec-error">
            The disk could not be loaded.
          </p>
        )}
      </div>
    );
  }

  const { detail } = load;
  const running = exhume.phase === "running";
  const truncated = detail.truncated || detail.card.entriesTruncated;

  const onExhumeAll = (): void => {
    setExhume({ phase: "running" });
    api.exhumeAll(diskId).then(
      (r) => {
        if (live.current) setExhume({ phase: "done", results: r.results });
      },
      () => {
        if (live.current) setExhume({ phase: "error" });
      },
    );
  };

  const nameFor = (r: ExhumeOutcome): string =>
    detail.files.find((f) => f.id === r.entry)?.path ?? r.path;

  return (
    <div className="ec-content" data-testid="disk-view">
      <div className="ec-row">
        <button className="ec-btn" type="button" onClick={onBack}>
          Back to library
        </button>
        <button className="ec-btn" type="button" onClick={() => onAskUndertaker(diskId)}>
          Ask the undertaker
        </button>
      </div>

      <DiskHeader card={detail.card} />

      {truncated ? (
        <p role="note" className="ec-card" data-testid="truncation-notice">
          {`Showing ${detail.files.length} of ${detail.totalEntries} entries. "Exhume all recoverable" covers only the entries shown.`}
        </p>
      ) : null}

      <div className="ec-row">
        <button
          className="ec-btn"
          type="button"
          disabled={running}
          title={EXHUME_ALL_TOOLTIP}
          aria-describedby="ec-exhume-tip"
          onClick={onExhumeAll}
        >
          Exhume all recoverable
        </button>
        <span id="ec-exhume-tip" className="ec-muted">
          {EXHUME_ALL_TOOLTIP}
        </span>
      </div>

      {exhume.phase === "error" ? (
        <p role="alert" className="ec-error" data-testid="exhume-error">
          The exhume request failed.
        </p>
      ) : null}
      {exhume.phase === "done" ? (
        <div>
          <ul aria-label="Exhume results" data-testid="exhume-results">
            {exhume.results.map((r, i) => (
              <li key={`${r.entry}-${i}`} data-outcome={r.outcome}>
                {r.outcome === "exhumed" && r.outputPath !== undefined
                  ? `${nameFor(r)} -> ${relativeOutput(r.outputPath)}${isOriginalCopy(r.outputPath) ? " (original bytes)" : ""}`
                  : r.outcome === "exhumed"
                    ? `${nameFor(r)}: succeeded`
                    : `${nameFor(r)}: failed${r.errorCode !== undefined ? ` (${r.errorCode})` : ""}`}
              </li>
            ))}
          </ul>
          <p className="ec-muted" data-testid="exhume-location">
            {libraryPath !== null
              ? `Exhumed files are in ${libraryPath.replace(/[\\/]+$/, "")}/exhumed/`
              : "Exhumed files are in the library's exhumed/ folder."}
          </p>
        </div>
      ) : null}

      <div className="ec-disk-grid" data-testid="disk-grid">
        <Graveyard files={detail.files} selected={selected} onSelect={setSelected} />
        <div className="ec-disk-side" data-testid="preview-column">
          <PreviewPane api={api} diskId={diskId} entry={selected} />
        </div>
      </div>
    </div>
  );
}
