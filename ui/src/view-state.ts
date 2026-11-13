/**
 * View state for the single page. Pure helpers, no React.
 * The view comes from the `?id=<64 hex>` query and is written back with `history.replaceState`
 * (Requirements 13.1, 13.7, 14.13).
 */
import { isValidDiskId } from "./lib/messages";

export type ViewState = { kind: "library" } | { kind: "disk"; id: string };

/** Reads the view from a `location.search` string. Anything but a valid Disk_Id gives the library. */
export function parseViewFromSearch(search: string): ViewState {
  const id = new URLSearchParams(search).get("id");
  return id !== null && isValidDiskId(id) ? { kind: "disk", id } : { kind: "library" };
}

/** Builds the query string (with leading `?`, or empty) for a view. */
export function searchForView(view: ViewState): string {
  return view.kind === "disk" ? `?id=${view.id}` : "";
}

/** Updates the URL query without changing the route. Never throws. */
export function writeViewToUrl(view: ViewState): void {
  try {
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state as unknown, "", `${pathname}${searchForView(view)}${hash}`);
  } catch {
    // The URL is a convenience; the in-memory view state stays authoritative.
  }
}
