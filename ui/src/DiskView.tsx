/**
 * Disk page: graveyard of tombstones (live files) and open graves (deleted entries), preview,
 * "Exhume all recoverable" and "Ask the undertaker" (Requirements 14.1 to 14.12).
 * Untrusted text (labels, file names, reasons) is only ever a React text child.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { FileEntry } from "../../src/shared/schema";
import type { DiskDetail, ExhumeApi, ExhumeOutcome } from "./lib/api";
import { PreviewPane } from "./PreviewPane";

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
  return (
    <li
      className="ec-grave"
      data-testid={deleted ? "open-grave" : "tombstone"}
      data-selected={selected ? "true" : "false"}
    >
      <span
        className="ec-grave-mark"
        aria-hidden="true"
        data-shape={deleted ? "pit" : "stone"}
        data-h={deleted ? undefined : String(stoneHeight(index))}
      />
      {isFile ? (
        <button
          className="ec-grave-btn"
          type="button"
          aria-pressed={selected}
          aria-label={label}
          onClick={() => onSelect(entry.id)}
        >
          <span className="ec-grave-name">{entry.path}</span>
          {deleted ? (
            <span className="ec-grave-grade" data-testid="grave-grade">
              <span className="ec-badge" data-grade={entry.state}>{`Grade: ${entry.state}`}</span>
              {entry.reason !== undefined ? <span>{` ${entry.reason}`}</span> : null}
            </span>
          ) : null}
        </button>
      ) : (
        <div className="ec-grave-static">
          <span className="ec-grave-name">{entry.path}</span>
          {deleted ? (
            <span className="ec-grave-grade" data-testid="grave-grade">
              <span className="ec-badge" data-grade={entry.state}>{`Grade: ${entry.state}`}</span>
              {entry.reason !== undefined ? <span>{` ${entry.reason}`}</span> : null}
            </span>
          ) : null}
        </div>
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
  const live = useRef(true);

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
        <h1>{detail.card.label === "" ? "Untitled disk" : detail.card.label}</h1>
        <button className="ec-btn" type="button" onClick={() => onAskUndertaker(diskId)}>
          Ask the undertaker
        </button>
      </div>

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
        <ul aria-label="Exhume results" data-testid="exhume-results">
          {exhume.results.map((r, i) => (
            <li key={`${r.entry}-${i}`} data-outcome={r.outcome}>
              {`${nameFor(r)}: ${r.outcome === "exhumed" ? "succeeded" : "failed"}`}
            </li>
          ))}
        </ul>
      ) : null}

      <Graveyard files={detail.files} selected={selected} onSelect={setSelected} />
      <PreviewPane api={api} diskId={diskId} entry={selected} />
    </div>
  );
}
