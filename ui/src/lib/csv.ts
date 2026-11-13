/**
 * Minimal CSV parser for the Disk page preview.
 *
 * Pure TypeScript: no DOM, no React. RFC 4180 style: comma separated, double
 * quote enclosure with doubled quotes as escapes, CRLF, LF or CR row ends.
 * Output is capped at 1,000 rows and 50 columns. Never throws.
 *
 * Requirement 14.4.
 */

export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_COLUMNS = 50;

export type CsvTable = {
  /** At most CSV_MAX_ROWS rows of at most CSV_MAX_COLUMNS cells each. */
  readonly rows: readonly (readonly string[])[];
  /** True when the source had more rows than were kept. */
  readonly truncatedRows: boolean;
  /** True when any row had more cells than were kept. */
  readonly truncatedColumns: boolean;
};

export function parseCsv(source: string): CsvTable {
  const rows: string[][] = [];
  let truncatedRows = false;
  let truncatedColumns = false;

  let row: string[] = [];
  let cellCount = 0; // cells seen in the current row, including dropped ones
  let cell = '';
  let inQuotes = false;
  let rowHasContent = false; // distinguishes a blank line from a row with one empty cell

  const endCell = (): void => {
    if (cellCount < CSV_MAX_COLUMNS) row.push(cell);
    else truncatedColumns = true;
    cellCount += 1;
    cell = '';
  };

  // Returns false once the row cap has been exceeded and parsing should stop.
  const endRow = (): boolean => {
    endCell();
    const blank = !rowHasContent;
    const finished = row;
    row = [];
    cellCount = 0;
    rowHasContent = false;
    if (blank) return true;
    if (rows.length >= CSV_MAX_ROWS) {
      truncatedRows = true;
      return false;
    }
    rows.push(finished);
    return true;
  };

  const len = source.length;
  let i = 0;
  let stopped = false;
  while (i < len) {
    const ch = source.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (source.charAt(i + 1) === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      rowHasContent = true;
      i += 1;
    } else if (ch === ',') {
      rowHasContent = true;
      endCell();
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      i += ch === '\r' && source.charAt(i + 1) === '\n' ? 2 : 1;
      if (!endRow()) {
        stopped = true;
        break;
      }
    } else {
      rowHasContent = true;
      cell += ch;
      i += 1;
    }
  }
  if (!stopped && (rowHasContent || cell !== '' || cellCount > 0)) {
    endRow();
  }
  return { rows, truncatedRows, truncatedColumns };
}
