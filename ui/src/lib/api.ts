/**
 * Typed wrapper over `useAppApi()`. Every path is under `/apps/exhume-crew/api`; the only
 * variable path part is a Disk_Id validated as 64 lower-case hex characters.
 */
import type { AppApi } from "@kirocrew/app-sdk";
import type {
  DiskCardView,
  FileEntry,
  ScanStatus,
} from "../../../src/shared/schema";
import { isValidDiskId } from "./messages";
import { saveBlob, type DownloadKind } from "./download";

export const API_BASE = "/apps/exhume-crew/api";

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface LibraryStatus {
  path: string | null;
  error: ApiErrorBody | null;
}

export interface DiskDetail {
  card: DiskCardView;
  files: FileEntry[];
  truncated: boolean;
  totalEntries: number;
}

export interface WarningView {
  code: string;
  message: string;
  path?: string;
}

export type PreviewResponse =
  | {
      kind: "text";
      format: "markdown" | "csv" | "text";
      text: string;
      truncated: boolean;
      warnings: WarningView[];
    }
  | {
      kind: "png";
      width: number;
      height: number;
      bytes: number;
      imageDataUrl: string | null;
      warnings: WarningView[];
    };

export interface ExhumeOutcome {
  entry: number;
  path: string;
  outcome: "exhumed" | "failed";
  outputPath?: string;
  errorCode?: string;
}

export interface DemoCopyResult {
  copied: string[];
  skipped: string[];
}

export interface ScanStart {
  started: boolean;
  running: boolean;
}

function diskPath(id: string): string {
  if (!isValidDiskId(id)) throw new RangeError("Invalid Disk_Id");
  return `${API_BASE}/disks/${id}`;
}

function entryNumber(entry: number): number {
  if (!Number.isSafeInteger(entry) || entry < 0) throw new RangeError("Invalid entry id");
  return entry;
}

export interface ExhumeApi {
  getLibrary(): Promise<LibraryStatus>;
  setLibrary(path: string): Promise<LibraryStatus>;
  copyDemoLibrary(): Promise<DemoCopyResult>;
  getScan(): Promise<ScanStatus>;
  startScan(): Promise<ScanStart>;
  listDisks(): Promise<{ disks: DiskCardView[] }>;
  getDisk(id: string): Promise<DiskDetail>;
  getPreview(id: string, entry: number): Promise<PreviewResponse>;
  exhumeAll(id: string): Promise<{ results: ExhumeOutcome[] }>;
  downloadCsv(): Promise<void>;
  downloadMarkdown(): Promise<void>;
}

export const EXPORT_CSV_PATH = `${API_BASE}/export/csv`;
export const EXPORT_MARKDOWN_PATH = `${API_BASE}/export/markdown`;

export function createApi(app: AppApi): ExhumeApi {
  async function download(path: string, kind: DownloadKind, fileName: string): Promise<void> {
    const res = await app.raw(path);
    if (!res.ok) throw new Error("Export failed");
    saveBlob(kind, await res.arrayBuffer(), fileName);
  }

  return {
    getLibrary: () => app.get<LibraryStatus>(`${API_BASE}/library`),
    setLibrary: (path) => app.put<LibraryStatus>(`${API_BASE}/library`, { path }),
    copyDemoLibrary: () => app.post<DemoCopyResult>(`${API_BASE}/library/demo`),
    getScan: () => app.get<ScanStatus>(`${API_BASE}/scan`),
    startScan: () => app.post<ScanStart>(`${API_BASE}/scan`),
    listDisks: () => app.get<{ disks: DiskCardView[] }>(`${API_BASE}/disks`),
    getDisk: (id) => app.get<DiskDetail>(diskPath(id)),
    getPreview: (id, entry) =>
      app.get<PreviewResponse>(`${diskPath(id)}/preview?entry=${entryNumber(entry)}`),
    exhumeAll: (id) => app.post<{ results: ExhumeOutcome[] }>(`${diskPath(id)}/exhume-all`),
    downloadCsv: () => download(EXPORT_CSV_PATH, "csv", "exhume-catalogue.csv"),
    downloadMarkdown: () => download(EXPORT_MARKDOWN_PATH, "markdown", "exhume-catalogue.md"),
  };
}
