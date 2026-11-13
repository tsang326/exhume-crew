/**
 * Parameter guard (Requirement 7.4). Runs after the signature check and
 * before any route handler. Each path segment and query key/value is decoded
 * exactly once; any `%` left after that decode is rejected, so double-encoded
 * traversal never reaches a handler.
 *
 * The set-Library-path body (PUT /api/library) is not inspected here: the
 * guard only looks at the URL. That body is validated by the LibraryManager.
 */
import { ApiError } from "./errors";

const DISK_ID_PATTERN = /^[0-9a-f]{64}$/;
const ENTRY_ID_PATTERN = /^(?:0|[1-9][0-9]{0,3})$/;
const MAX_ENTRY_ID = 4095;

// C0 controls (incl. NUL), DEL and C1 controls.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export interface GuardedParams {
  /** Decoded, non-empty path segments. */
  readonly segments: readonly string[];
  /** Decoded query values, keyed by decoded name. */
  readonly query: Readonly<Record<string, string>>;
}

export type GuardResult =
  | { readonly ok: true; readonly params: GuardedParams }
  | { readonly ok: false; readonly error: ApiError };

function bad(): GuardResult {
  return { ok: false, error: new ApiError("BAD_PARAMETER", 400) };
}

/** Decodes once. Returns null if the escape sequence is malformed. */
function decodeOnce(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function isUnsafe(decoded: string, isSegment: boolean): boolean {
  if (decoded.includes("%")) return true; // encoded traversal after one decode
  if (decoded.includes("..")) return true;
  if (CONTROL_CHARS.test(decoded)) return true;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return true;
  // A path segment can never legitimately hold a separator (e.g. from %2F).
  if (isSegment && (decoded.includes("/") || decoded.includes("\\"))) return true;
  return false;
}

/**
 * @param url raw request target (`req.url`), path plus optional query.
 * @param routeParamNames query parameter names the route accepts; any other
 *   query name is rejected.
 */
export function guardParams(url: string, routeParamNames: readonly string[]): GuardResult {
  if (typeof url !== "string" || CONTROL_CHARS.test(url)) return bad();

  const hashAt = url.indexOf("#");
  const target = hashAt === -1 ? url : url.slice(0, hashAt);
  const qAt = target.indexOf("?");
  const rawPath = qAt === -1 ? target : target.slice(0, qAt);
  const rawQuery = qAt === -1 ? "" : target.slice(qAt + 1);

  if (!rawPath.startsWith("/")) return bad();

  const segments: string[] = [];
  for (const rawSegment of rawPath.slice(1).split("/")) {
    if (rawSegment === "") continue;
    const decoded = decodeOnce(rawSegment);
    if (decoded === null || isUnsafe(decoded, true)) return bad();
    segments.push(decoded);
  }

  const allowed = new Set(routeParamNames);
  const query: Record<string, string> = Object.create(null) as Record<string, string>;
  if (rawQuery !== "") {
    for (const pair of rawQuery.split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      const name = decodeOnce(rawName.replace(/\+/g, " "));
      const value = decodeOnce(rawValue.replace(/\+/g, " "));
      if (name === null || value === null) return bad();
      if (isUnsafe(name, false) || isUnsafe(value, false)) return bad();
      if (!allowed.has(name) || name in query) return bad();
      query[name] = value;
    }
  }

  return { ok: true, params: { segments, query } };
}

/** A Disk_Id is exactly 64 lower-case hex characters. Returns null otherwise. */
export function parseDiskId(value: unknown): string | null {
  return typeof value === "string" && DISK_ID_PATTERN.test(value) ? value : null;
}

/** An entry id is a decimal integer from 0 to 4095. Returns null otherwise. */
export function parseEntryId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_ENTRY_ID ? value : null;
  }
  if (typeof value !== "string" || !ENTRY_ID_PATTERN.test(value)) return null;
  const n = Number(value);
  return n <= MAX_ENTRY_ID ? n : null;
}
